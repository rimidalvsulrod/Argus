"use client";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as faceapi from "@vladmandic/face-api/dist/face-api.esm-nobundle.js";
import type { EventType, Face, Settings } from "./types";

export type Emit = (e: { type: EventType; label: string; conf?: number; img?: string; desc?: number[] }) => void;
export type Box = { x: number; y: number; w: number; h: number; label: string; color: string };

const W = 64, H = 48, N = W * H;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Engine {
  settings: Settings;
  faces: Face[] = [];
  boxes: Box[] = [];
  stats = { motion: 0, light: 0, lightDelta: 0, sound: 0, soundBase: 0, change: 0, persons: 0 };
  ready = false;
  private running = false;
  private armedAt = Date.now();
  private wasArmed = true;
  private last: Record<string, number> = {};
  private cv = document.createElement("canvas");
  private cx: CanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private ref: Float32Array | null = null;
  private lightHist: number[] = [];
  private motionHits = 0;
  private lastMotionAt = 0;
  private analyser?: AnalyserNode;
  private buf?: Float32Array<ArrayBuffer>;
  private coco?: cocoSsd.ObjectDetection;

  constructor(private video: HTMLVideoElement, settings: Settings, private emit: Emit, stream?: MediaStream) {
    this.settings = settings;
    this.cv.width = W; this.cv.height = H;
    this.cx = this.cv.getContext("2d", { willReadFrequently: true })!;
    if (stream && stream.getAudioTracks().length) {
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      this.analyser = ac.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
  }

  setSettings(s: Settings) {
    if (s.armed && !this.wasArmed) this.armedAt = Date.now(); // re-arming restarts the grace delay
    this.wasArmed = s.armed;
    this.settings = s;
  }

  async start() {
    this.running = true;
    this.armedAt = Date.now();
    this.fastLoop();
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      cocoSsd.load({ modelUrl: "/models/coco/model.json" }).then((m) => (this.coco = m)),
    ]);
    this.ready = true;
    this.aiLoop();
  }
  stop() { this.running = false; }

  // ---- alert gate: armed, past grace period, per-type cooldown ----
  private fire(key: string, type: EventType, label: string, conf?: number, desc?: number[]) {
    const s = this.settings, now = Date.now();
    if (!s.armed || now < this.armedAt + s.armDelay * 1000) return;
    if (now - (this.last[key] ?? 0) < s.cooldown * 1000) return;
    this.last[key] = now;
    this.emit({ type, label, conf, desc, img: s.snapshots ? this.snapshot() : undefined });
  }
  private snapshot() {
    const v = this.video;
    if (!v.videoWidth) return undefined;
    const c = document.createElement("canvas");
    c.width = 320; c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.55);
  }

  // ---- fast pixel/audio checks, ~5x per second ----
  private async fastLoop() {
    while (this.running) {
      try { this.pixelStep(); this.soundStep(); } catch {}
      await sleep(200);
    }
  }
  private pixelStep() {
    if (this.video.readyState < 2) return;
    this.cx.drawImage(this.video, 0, 0, W, H);
    const d = this.cx.getImageData(0, 0, W, H).data;
    const g = new Float32Array(N);
    let sum = 0;
    for (let i = 0; i < N; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
    const mean = sum / N, s = this.settings;

    // motion: fraction of pixels that changed since last frame
    if (this.prev) {
      let c = 0;
      for (let i = 0; i < N; i++) if (Math.abs(g[i] - this.prev[i]) > 25) c++;
      this.stats.motion = c / N;
      const thr = 0.15 * Math.pow(0.7, s.motion.sens - 1);
      this.motionHits = this.stats.motion > thr ? this.motionHits + 1 : 0;
      if (this.stats.motion > thr * 0.5) this.lastMotionAt = Date.now();
      if (s.motion.on && this.motionHits >= 2) this.fire("motion", "motion", `Movement (${(this.stats.motion * 100).toFixed(0)}% of frame)`, this.stats.motion);
    }
    this.prev = g;

    // any change: differs from slow-moving reference of the scene (catches slow/lingering changes)
    if (!this.ref) this.ref = g.slice();
    else {
      let c = 0;
      for (let i = 0; i < N; i++) { if (Math.abs(g[i] - this.ref[i]) > 35) c++; this.ref[i] += (g[i] - this.ref[i]) * 0.01; }
      this.stats.change = c / N;
      const thr = 0.25 * Math.pow(0.72, s.change.sens - 1);
      if (s.change.on && this.stats.change > thr) this.fire("change", "change", `Scene changed (${(this.stats.change * 100).toFixed(0)}%)`, this.stats.change);
    }

    // light: mean brightness now vs ~1.6s ago
    this.stats.light = mean;
    this.lightHist.push(mean);
    if (this.lightHist.length > 15) this.lightHist.shift();
    if (this.lightHist.length >= 8) {
      const delta = mean - this.lightHist[this.lightHist.length - 8];
      this.stats.lightDelta = delta;
      const thr = 40 * Math.pow(0.75, s.light.sens - 1);
      if (s.light.on && Math.abs(delta) > thr) this.fire("light", "light", delta > 0 ? "Light turned on / brighter" : "Light turned off / darker", Math.abs(delta) / 255);
    }
  }
  private soundStep() {
    if (!this.analyser || !this.buf) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sq = 0;
    for (const v of this.buf) sq += v * v;
    const rms = Math.sqrt(sq / this.buf.length), s = this.settings;
    this.stats.sound = rms;
    const base = this.stats.soundBase || rms;
    const thr = Math.max(0.015 + (10 - s.sound.sens) * 0.004, base * (1 + (11 - s.sound.sens) * 0.6));
    if (s.sound.on && rms > thr) this.fire("sound", "sound", `Noise (level ${(rms * 100).toFixed(0)})`, rms);
    else this.stats.soundBase = base * 0.99 + rms * 0.01;
  }

  // ---- AI: humans (COCO-SSD) + faces (face-api descriptors), ~1x per second ----
  private async aiLoop() {
    while (this.running) {
      const t0 = performance.now();
      try { await this.aiStep(); } catch (e) { console.error(e); }
      await sleep(Math.max(150, 600 - (performance.now() - t0)));
    }
  }
  private lastFace = 0;
  private async aiStep() {
    const v = this.video, s = this.settings;
    if (v.readyState < 2 || !v.videoWidth) return;
    const wantFaces = s.faceUnknown.on || s.faceKnown.on;
    if (!s.person.on && !wantFaces) { this.boxes = []; return; }
    const boxes: Box[] = [];
    const minScore = Math.max(0.3, 0.7 - s.person.sens * 0.04);
    const preds = (await this.coco!.detect(v, 10, minScore)).filter((p) => p.class === "person");
    this.stats.persons = preds.length;
    for (const p of preds) boxes.push({ x: p.bbox[0] / v.videoWidth, y: p.bbox[1] / v.videoHeight, w: p.bbox[2] / v.videoWidth, h: p.bbox[3] / v.videoHeight, label: `HUMAN ${(p.score * 100).toFixed(0)}`, color: "#ff3b5c" });
    if (preds.length && s.person.on) this.fire("person", "person", `Human detected${preds.length > 1 ? ` (${preds.length})` : ""}`, Math.max(...preds.map((p) => p.score)));

    if (wantFaces && (preds.length || Date.now() - this.lastMotionAt < 3000) && Date.now() - this.lastFace > 1000) {
      this.lastFace = Date.now();
      for (const r of await this.detectFaces()) {
        const m = this.match(r.desc);
        const b = r.box;
        boxes.push({ x: b.x / v.videoWidth, y: b.y / v.videoHeight, w: b.width / v.videoWidth, h: b.height / v.videoHeight, label: m ? m.name.toUpperCase() : "UNKNOWN", color: m ? "#3bffb0" : "#ffb020" });
        if (m && s.faceKnown.on) this.fire(`known:${m.name}`, "face_known", `${m.name} recognised`, 1 - m.dist);
        if (!m && s.faceUnknown.on) this.fire("unknown", "face_unknown", "Unknown face", undefined, r.desc);
      }
    }
    this.boxes = boxes;
  }
  async detectFaces() {
    const res = await faceapi
      .detectAllFaces(this.video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    return res.map((r) => ({ box: r.detection.box, desc: Array.from(r.descriptor) as number[] }));
  }
  private match(desc: number[]) {
    let best: { name: string; dist: number } | null = null;
    for (const f of this.faces) for (const d of f.descs) {
      let s = 0;
      for (let i = 0; i < 128; i++) { const x = d[i] - desc[i]; s += x * x; }
      const dist = Math.sqrt(s);
      if (dist < 0.5 && (!best || dist < best.dist)) best = { name: f.name, dist };
    }
    return best;
  }
}
