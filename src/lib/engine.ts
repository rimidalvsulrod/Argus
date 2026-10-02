"use client";
import * as tf from "@tensorflow/tfjs";
import * as poseDetection from "@tensorflow-models/pose-detection";
import * as faceapi from "@vladmandic/face-api/dist/face-api.esm-nobundle.js";
import { drawScene, type FaceMark, type Scene } from "./overlay";
import type { EventType, Face, Settings, Stats } from "./types";

export type Emit = (e: { type: EventType; label: string; conf?: number; img?: string; desc?: number[] }) => void;

const W = 64, H = 48, N = W * H;
const CAL_FRAMES = 15; // ~3s of samples to learn the zero point
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Engine {
  settings: Settings;
  faces: Face[] = [];
  scene: Scene = { persons: [], faces: [] };
  stats: Stats = { motion: 0, light: 0, sound: 0, dev: 0, persons: 0, faces: 0, calibAt: 0, calibState: 0 };
  calibProgress = 0;
  ready = false;
  private running = false;
  private armedAt = Date.now();
  private wasArmed = true;
  private last: Record<string, number> = {};
  private cv = document.createElement("canvas");
  private cx: CanvasRenderingContext2D;
  private prev: Float32Array | null = null;
  private lightHist: number[] = [];
  private motionHits = 0;
  private noise = 4; // running estimate of per-pixel sensor noise
  private personHist: boolean[] = [];
  private unknownHits = 0;
  private lastMotionAt = 0;
  private soundBase = 0;
  private analyser?: AnalyserNode;
  private buf?: Float32Array<ArrayBuffer>;
  private pose?: poseDetection.PoseDetector;
  // calibration (zero point): per-pixel mean + tolerance learned from noise
  private calSum?: Float32Array;
  private calSq?: Float32Array;
  private calN = 0;
  private calMean?: Float32Array;
  private calTol?: Float32Array;
  private handledCalibAt = Date.now();

  constructor(private video: HTMLVideoElement, settings: Settings, private emit: Emit, stream?: MediaStream) {
    this.settings = settings;
    this.cv.width = W; this.cv.height = H;
    this.cx = this.cv.getContext("2d", { willReadFrequently: true })!;
    if (stream && stream.getAudioTracks().length) {
      const ac = new AudioContext();
      this.analyser = ac.createAnalyser();
      this.analyser.fftSize = 8192; // ~170ms window so short bangs/claps between samples aren't missed
      ac.createMediaStreamSource(stream).connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
    }
  }

  setSettings(s: Settings) {
    if (s.armed && !this.wasArmed) this.armedAt = Date.now(); // re-arming restarts the grace delay
    this.wasArmed = s.armed;
    this.settings = s;
    if (s.calib.at > this.handledCalibAt) this.calibrate(s.calib.at);
  }

  calibrate(at = Date.now()) {
    this.handledCalibAt = Math.max(this.handledCalibAt, at);
    this.calSum = new Float32Array(N);
    this.calSq = new Float32Array(N);
    this.calN = 0;
    this.calibProgress = 0;
    this.stats.calibState = 1;
    this.stats.dev = 0;
  }

  async start() {
    this.running = true;
    this.armedAt = Date.now();
    this.calibrate(Date.now());
    this.fastLoop();
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      poseDetection
        .createDetector(poseDetection.SupportedModels.MoveNet, {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          modelUrl: "/models/movenet/model.json",
          enableTracking: true,
          trackerType: poseDetection.TrackerType.BoundingBox,
        })
        .then((d) => (this.pose = d)),
    ]);
    this.ready = true;
    this.aiLoop();
  }
  stop() { this.running = false; this.pose?.dispose(); }

  // ---- alert gate: armed, past grace period, per-type cooldown ----
  private fire(key: string, type: EventType, label: string, conf?: number, desc?: number[]) {
    const s = this.settings, now = Date.now();
    if (!s.armed || now < this.armedAt + s.armDelay * 1000) return;
    if (now - (this.last[key] ?? 0) < s.cooldown * 1000) return;
    this.last[key] = now;
    this.emit({ type, label, conf, desc, img: s.snapshots ? this.snapshot(480, 0.6) : undefined });
  }
  snapshot(width: number, q: number) {
    const v = this.video;
    if (!v.videoWidth) return undefined;
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    const x = c.getContext("2d")!;
    x.drawImage(v, 0, 0, c.width, c.height);
    drawScene(x, this.scene, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
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

    // motion: size of the largest connected region of changed pixels since last frame.
    // Global brightness shifts (auto-exposure) are subtracted out; the pixel threshold adapts to sensor noise,
    // and scattered noise pixels don't form a blob, so they don't count.
    if (this.prev) {
      let shift = 0;
      for (let i = 0; i < N; i++) shift += g[i] - this.prev[i];
      shift /= N;
      const pixThr = Math.min(40, Math.max(14, 3 * this.noise + 8));
      const mask = new Uint8Array(N);
      let absSum = 0;
      for (let i = 0; i < N; i++) {
        const dd = Math.abs(g[i] - this.prev[i] - shift);
        absSum += dd;
        if (dd > pixThr) mask[i] = 1;
      }
      const blob = largestBlob(mask);
      this.stats.motion = blob.size / N;
      const thr = 0.08 * Math.pow(0.7, s.motion.sens - 1);
      if (this.stats.motion < thr * 0.3) this.noise = this.noise * 0.95 + (absSum / N) * 0.05; // learn noise only when still
      this.motionHits = this.stats.motion > thr ? this.motionHits + 1 : 0;
      this.scene.zone = this.stats.motion > thr * 0.5 ? blob.box : null;
      if (this.stats.motion > thr * 0.5) this.lastMotionAt = Date.now();
      if (s.motion.on && this.motionHits >= 2) this.fire("motion", "motion", `Movement (${(this.stats.motion * 100).toFixed(1)}% of frame)`, this.stats.motion);
    }
    this.prev = g;

    // calibration: learn the zero point, then measure deviation from it
    if (this.stats.calibState === 1 && this.calSum && this.calSq) {
      for (let i = 0; i < N; i++) { this.calSum[i] += g[i]; this.calSq[i] += g[i] * g[i]; }
      this.calibProgress = ++this.calN / CAL_FRAMES;
      if (this.calN >= CAL_FRAMES) {
        const m = new Float32Array(N), tol = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          m[i] = this.calSum[i] / this.calN;
          const sd = Math.sqrt(Math.max(0, this.calSq[i] / this.calN - m[i] * m[i]));
          tol[i] = Math.max(14, 4 * sd + 4); // ignore normal sensor noise / flicker
        }
        this.calMean = m; this.calTol = tol;
        this.stats.calibState = 2;
        this.stats.calibAt = Date.now();
      }
    } else if (this.stats.calibState === 2 && this.calMean && this.calTol) {
      let c = 0;
      for (let i = 0; i < N; i++) if (Math.abs(g[i] - this.calMean[i]) > this.calTol[i]) c++;
      this.stats.dev = this.stats.dev * 0.5 + (c / N) * 100 * 0.5;
      if (s.calib.on && this.stats.dev > s.calib.trip) this.fire("change", "change", `Scene deviated ${this.stats.dev.toFixed(1)}% from zero`, this.stats.dev / 100);
    }

    // light: mean brightness now vs ~1.6s ago
    this.stats.light = mean;
    this.lightHist.push(mean);
    if (this.lightHist.length > 15) this.lightHist.shift();
    if (this.lightHist.length >= 8) {
      const h = this.lightHist, n = h.length;
      const delta = (h[n - 1] + h[n - 2]) / 2 - (h[n - 8] + h[n - 7]) / 2; // 2-sample averages to resist flicker
      const thr = 40 * Math.pow(0.75, s.light.sens - 1);
      if (s.light.on && Math.abs(delta) > thr) this.fire("light", "light", delta > 0 ? "Light turned on / brighter" : "Light turned off / darker", Math.abs(delta) / 255);
    }
  }
  private soundStep() {
    if (!this.analyser || !this.buf) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sq = 0, peak = 0;
    for (const v of this.buf) { sq += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
    const rms = Math.sqrt(sq / this.buf.length), s = this.settings;
    this.stats.sound = rms;
    const base = this.soundBase || rms;
    const thr = Math.max(0.012 + (10 - s.sound.sens) * 0.004, base * (1 + (11 - s.sound.sens) * 0.6));
    // sustained noise (rms) or a sharp impulse like a bang, knock or glass break (peak)
    if (s.sound.on && (rms > thr || peak > Math.max(0.12, thr * 5))) this.fire("sound", "sound", rms > thr ? `Sustained noise (level ${(rms * 100).toFixed(0)})` : "Sharp impact sound", Math.max(rms, peak));
    else this.soundBase = base * 0.99 + rms * 0.01;
  }

  // ---- AI: bodies (MoveNet multipose) ~6fps, faces (face-api) ~1.5fps ----
  private async aiLoop() {
    while (this.running) {
      const t0 = performance.now();
      try { await this.aiStep(); } catch (e) { console.error(e); }
      // without GPU (cpu backend) inference blocks the main thread; back off so pixel/sound checks keep running
      const gpu = tf.getBackend() === "webgl";
      await sleep(gpu ? Math.max(40, 160 - (performance.now() - t0)) : Math.max(400, (performance.now() - t0) * 1.5));
    }
  }
  private lastFace = 0;
  private async aiStep() {
    const v = this.video, s = this.settings;
    if (v.readyState < 2 || !v.videoWidth || !this.pose) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    const minScore = Math.max(0.15, 0.5 - s.person.sens * 0.03);
    const poses = await this.pose.estimatePoses(v, { maxPoses: 6, flipHorizontal: false });
    const persons = poses.filter((p) => (p.score ?? 0) >= minScore && p.keypoints.filter((k) => (k.score ?? 0) > 0.3).length >= 4);
    this.scene.persons = persons.map((p, i) => ({
      id: p.id ?? i + 1,
      score: r3(p.score ?? 0),
      box: p.box ? [r3(p.box.xMin), r3(p.box.yMin), r3(p.box.width), r3(p.box.height)] : [0, 0, 0, 0],
      kp: p.keypoints.map((k) => [r3(k.x / vw), r3(k.y / vh), r3(k.score ?? 0)] as [number, number, number]),
    }));
    this.stats.persons = persons.length;
    // require the body in 2 of the last 3 passes so single-frame glitches don't alert
    this.personHist = [...this.personHist.slice(-2), persons.length > 0];
    const confirmed = this.personHist.filter(Boolean).length >= 2;
    if (confirmed && s.person.on) this.fire("person", "person", `Human detected${persons.length > 1 ? ` (${persons.length})` : ""}`, Math.max(...persons.map((p) => p.score ?? 0)));

    const wantFaces = s.faceUnknown.on || s.faceKnown.on;
    const now = Date.now();
    if (!wantFaces || (!persons.length && now - this.lastMotionAt > 3000)) {
      if (now - this.lastFace > 1500) { this.scene.faces = []; this.stats.faces = 0; }
      return;
    }
    if (now - this.lastFace < 650) return;
    this.lastFace = now;
    const marks: FaceMark[] = [];
    let unknownNow: number[] | null = null;
    for (const r of await this.detectFaces()) {
      // faces under ~7% of frame width give unreliable identity: show them, but don't call them unknown
      if (r.box[2] < 0.07) { marks.push({ box: r.box, pts: r.pts, name: "?" }); continue; }
      const m = this.match(r.desc);
      const known = m && m.dist < 0.5, unknown = !m || m.dist > 0.6; // 0.5–0.6 = uncertain, no alert
      marks.push({ box: r.box, pts: r.pts, name: known ? m!.name : unknown ? null : "?" });
      if (known && s.faceKnown.on) this.fire(`known:${m!.name}`, "face_known", `${m!.name} recognised`, 1 - m!.dist);
      if (unknown) unknownNow = r.desc;
    }
    this.unknownHits = unknownNow ? this.unknownHits + 1 : 0;
    if (unknownNow && this.unknownHits >= 2 && s.faceUnknown.on) this.fire("unknown", "face_unknown", "Unidentified face", undefined, unknownNow);
    this.scene.faces = marks;
    this.stats.faces = marks.length;
  }
  async detectFaces() {
    const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
    const res = await faceapi
      .detectAllFaces(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .withFaceDescriptors();
    return res.map((r) => {
      const b = r.detection.box;
      return {
        box: [r3(b.x / vw), r3(b.y / vh), r3(b.width / vw), r3(b.height / vh)] as [number, number, number, number],
        pts: r.landmarks.positions.map((p) => [r3(p.x / vw), r3(p.y / vh)] as [number, number]),
        desc: Array.from(r.descriptor) as number[],
      };
    });
  }
  private match(desc: number[]) {
    let best: { name: string; dist: number } | null = null;
    for (const f of this.faces) for (const d of f.descs) {
      let s = 0;
      for (let i = 0; i < 128; i++) { const x = d[i] - desc[i]; s += x * x; }
      const dist = Math.sqrt(s);
      if (!best || dist < best.dist) best = { name: f.name, dist };
    }
    return best;
  }
}

// 4-connected component labelling on a W×H mask; returns the biggest region and its normalized bounds.
function largestBlob(mask: Uint8Array) {
  const seen = new Uint8Array(N), stack = new Int32Array(N);
  let best = { size: 0, box: [0, 0, 0, 0] as [number, number, number, number] };
  for (let s = 0; s < N; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, size = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const i = stack[--sp], x = i % W, y = (i / W) | 0;
      size++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W; }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W; }
    }
    if (size > best.size) best = { size, box: [x0 / W, y0 / H, (x1 - x0 + 1) / W, (y1 - y0 + 1) / H] };
  }
  return best;
}
