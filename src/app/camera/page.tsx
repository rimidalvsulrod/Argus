"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getKey } from "@/lib/api";
import { Engine } from "@/lib/engine";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "live">("idle");
  const [err, setErr] = useState("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ratio, setRatio] = useState(4 / 3);
  const [stealth, setStealth] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [hud, setHud] = useState({ motion: 0, light: 0, sound: 0, persons: 0, ready: false, armed: true });
  const queue = useRef<any[]>([]);

  useEffect(() => { if (!getKey()) location.href = "/"; }, []);

  const flush = useCallback(async () => {
    while (queue.current.length) {
      try { await api("/api/events", { json: queue.current[0] }); queue.current.shift(); } catch { return; }
    }
  }, []);

  const begin = useCallback(async (face: "environment" | "user") => {
    setErr(""); setPhase("loading");
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      engineRef.current?.stop();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: face, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: face } })); // no mic? still run
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream; await v.play();
      setRatio(v.videoWidth / v.videoHeight || 4 / 3);
      try { await (navigator as any).wakeLock?.request("screen"); } catch {}
      let settings = DEFAULT_SETTINGS;
      try { settings = (await api<any>("/api/state")).settings; } catch {}
      const eng = new Engine(v, settings, (e) => {
        setLog((l) => [`${new Date().toLocaleTimeString()}  ${e.label}`, ...l].slice(0, 6));
        queue.current.push({ ...e, ts: Date.now() });
        flush();
      }, stream);
      engineRef.current = eng;
      setPhase("live");
      await eng.start();
    } catch (e: any) { setErr(e.message || String(e)); setPhase("idle"); }
  }, [flush]);

  // heartbeat: report status, pull settings + face DB changes
  useEffect(() => {
    if (phase !== "live") return;
    let rev = -1, stop = false;
    const beat = async () => {
      const eng = engineRef.current; if (!eng || stop) return;
      let battery: number | undefined, charging: boolean | undefined;
      try { const b = await (navigator as any).getBattery?.(); battery = b?.level; charging = b?.charging; } catch {}
      try {
        const r = await api<{ settings: Settings; facesRev: number }>("/api/heartbeat", { json: { battery, charging } });
        eng.setSettings(r.settings);
        if (r.facesRev !== rev) { rev = r.facesRev; eng.faces = await api("/api/faces"); }
      } catch {}
      flush();
    };
    beat();
    const t = setInterval(beat, 15000);
    const vis = () => { if (document.visibilityState === "visible") (navigator as any).wakeLock?.request("screen").catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [phase, flush]);

  // HUD + detection boxes
  useEffect(() => {
    if (phase !== "live") return;
    let raf = 0, tick = 0;
    const draw = () => {
      const eng = engineRef.current, cv = overlayRef.current;
      if (eng && cv) {
        const c = cv.getContext("2d")!;
        cv.width = cv.clientWidth; cv.height = cv.clientHeight;
        c.lineWidth = 2; c.font = "12px monospace";
        for (const b of eng.boxes) {
          c.strokeStyle = c.fillStyle = b.color;
          c.strokeRect(b.x * cv.width, b.y * cv.height, b.w * cv.width, b.h * cv.height);
          c.fillText(b.label, b.x * cv.width + 3, Math.max(12, b.y * cv.height - 4));
        }
        if (++tick % 10 === 0) setHud({ motion: eng.stats.motion, light: eng.stats.light, sound: eng.stats.sound, persons: eng.stats.persons, ready: eng.ready, armed: eng.settings.armed });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  async function learn() {
    const eng = engineRef.current;
    if (!eng || !name.trim()) return setMsg("Enter a name first");
    setMsg("Scanning…");
    const faces = await eng.detectFaces();
    if (faces.length !== 1) return setMsg(faces.length ? "Multiple faces — only one person in frame" : "No face found — face the camera, good light");
    const f = await api<any[]>("/api/faces", { json: { name: name.trim(), desc: faces[0].desc } });
    eng.faces = f;
    setMsg(`Learned ${name.trim()}. Repeat from different angles for accuracy.`);
  }

  const bar = (v: number, max: number) => <div className="bar"><i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></div>;

  return (
    <div className="wrap" style={{ paddingTop: 10 }}>
      <h2>ARGUS // SENTRY {phase === "live" && <span style={{ color: hud.armed ? "var(--gr)" : "var(--am)" }}>{hud.armed ? "ARMED" : "DISARMED"}</span>}</h2>
      <div className="vid" style={{ aspectRatio: ratio, display: phase === "idle" ? "none" : "block" }}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={overlayRef} />
      </div>
      {phase === "idle" && (
        <div className="panel grid">
          <p className="dim sm">Prop the phone up, plug it in, and keep this screen open. Camera and microphone access required. Browsers pause detection if the tab is backgrounded or the screen locks — Sentry holds a wake-lock to prevent that.</p>
          <button className="big" onClick={() => begin(facing)}>Activate sentry</button>
          {err && <div style={{ color: "var(--rd)" }}>{err}</div>}
        </div>
      )}
      {phase !== "idle" && (
        <>
          <div className="panel sm">
            {!hud.ready ? <div style={{ color: "var(--am)" }}>Loading detection models…</div> : <div style={{ color: "var(--gr)" }}>AI online</div>}
            <div>MOTION {(hud.motion * 100).toFixed(1)}%{bar(hud.motion, 0.15)}</div>
            <div>LIGHT {hud.light.toFixed(0)}{bar(hud.light, 255)}</div>
            <div>SOUND {(hud.sound * 100).toFixed(1)}{bar(hud.sound, 0.3)}</div>
            <div>HUMANS {hud.persons}</div>
          </div>
          <div className="row">
            <button onClick={() => setStealth(true)}>Stealth screen</button>
            <button onClick={() => { const f = facing === "environment" ? "user" : "environment"; setFacing(f); begin(f); }}>Flip cam</button>
          </div>
          <div className="panel grid">
            <h2>Learn a face</h2>
            <input type="text" placeholder="Name (face the camera)" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="ok" onClick={learn}>Learn face</button>
            {msg && <div className="sm dim">{msg}</div>}
          </div>
          <div className="panel sm"><h2>Local log</h2>{log.map((l, i) => <div key={i}>{l}</div>)}{!log.length && <span className="dim">No triggers yet</span>}</div>
        </>
      )}
      {stealth && <div className="stealth" onClick={() => setStealth(false)}>tap to wake</div>}
    </div>
  );
}
