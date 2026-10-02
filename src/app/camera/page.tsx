"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, Radar, RefreshCw, ScanFace, X } from "lucide-react";
import { api, getKey } from "@/lib/api";
import { Engine } from "@/lib/engine";
import { paint } from "@/lib/overlay";
import { SentryLink, type Msg } from "@/lib/rtc";
import { DEFAULT_SETTINGS, type Settings, type Stats } from "@/lib/types";

type Hud = { stats: Stats; prog: number; ready: boolean; armed: boolean; viewers: number; link: boolean };

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const linkRef = useRef<SentryLink | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queue = useRef<object[]>([]);
  const [phase, setPhase] = useState<"idle" | "loading" | "live">("idle");
  const [err, setErr] = useState("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ratio, setRatio] = useState(4 / 3);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [stealth, setStealth] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [flash, setFlash] = useState("");
  const [hud, setHud] = useState<Hud | null>(null);

  useEffect(() => { if (!getKey()) location.href = "/"; }, []);

  const flush = useCallback(async () => {
    while (queue.current.length) {
      try { await api("/api/events", { json: queue.current[0] }); queue.current.shift(); linkRef.current?.send({ t: "ev" }); }
      catch { return; }
    }
  }, []);

  const onMsg = useCallback((m: Msg) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (m.t === "calibrate") eng.calibrate(m.at);
    if (m.t === "settings") eng.setSettings(m.s as Settings);
  }, []);

  const begin = useCallback(async (face: "environment" | "user") => {
    setErr(""); setPhase("loading");
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      engineRef.current?.stop();
      const stream = await navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: face } }));
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setRatio(v.videoWidth / v.videoHeight || 4 / 3);
      try { await (navigator as any).wakeLock?.request("screen"); } catch {}
      let settings = DEFAULT_SETTINGS;
      try { settings = (await api<{ settings: Settings }>("/api/state")).settings; } catch {}
      const eng = new Engine(v, settings, (e) => {
        setFlash(e.label); setTimeout(() => setFlash(""), 2500);
        queue.current.push({ ...e, ts: Date.now() });
        flush();
      }, stream);
      engineRef.current = eng;
      if (linkRef.current) linkRef.current.setStream(stream);
      else { linkRef.current = new SentryLink(stream, onMsg); linkRef.current.start().catch(() => {}); }
      setPhase("live");
      await eng.start();
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError" ? "Camera/microphone permission was denied. Allow it in the browser's site settings." : e.message || String(e));
      setPhase("idle");
    }
  }, [flush, onMsg]);

  // fit the video frame inside the available area
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const fit = () => {
      const W = el.clientWidth, H = el.clientHeight;
      setBox(W / H > ratio ? { w: H * ratio, h: H } : { w: W, h: W / ratio });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio, phase]);

  // heartbeat: status + peer id + thumbnail up, settings + face DB down
  useEffect(() => {
    if (phase !== "live") return;
    let rev = -1, stop = false;
    const beat = async () => {
      const eng = engineRef.current, link = linkRef.current;
      if (!eng || stop) return;
      let battery: number | undefined, charging: boolean | undefined;
      try { const b = await (navigator as any).getBattery?.(); battery = b?.level; charging = b?.charging; } catch {}
      try {
        const r = await api<{ settings: Settings; facesRev: number }>("/api/heartbeat", {
          json: { battery, charging, stats: eng.stats, peer: link?.id, token: link?.token, thumb: eng.snapshot(320, 0.5) },
        });
        eng.setSettings(r.settings);
        if (r.facesRev !== rev) { rev = r.facesRev; eng.faces = await api("/api/faces"); }
      } catch {}
      flush();
    };
    const first = setTimeout(beat, 1500);
    const t = setInterval(beat, 15000);
    const vis = () => { if (document.visibilityState === "visible") (navigator as any).wakeLock?.request("screen").catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearTimeout(first); clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [phase, flush]);

  // overlay at display rate; telemetry to live viewers at 5Hz; HUD at ~4Hz
  useEffect(() => {
    if (phase !== "live") return;
    let raf = 0;
    const draw = () => {
      const eng = engineRef.current;
      if (eng && canvasRef.current) paint(canvasRef.current, eng.scene);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const t = setInterval(() => {
      const eng = engineRef.current, link = linkRef.current;
      if (!eng) return;
      link?.send({ t: "tele", d: { scene: eng.scene, stats: eng.stats, prog: eng.calibProgress, armed: eng.settings.armed, ready: eng.ready, ratio: eng ? ratio : 0 } });
      setHud({ stats: { ...eng.stats }, prog: eng.calibProgress, ready: eng.ready, armed: eng.settings.armed, viewers: link?.viewers ?? 0, link: !!link?.online });
    }, 220);
    return () => { cancelAnimationFrame(raf); clearInterval(t); };
  }, [phase, ratio]);

  async function learn() {
    const eng = engineRef.current;
    if (!eng?.ready) return setMsg("Models still loading…");
    if (!name.trim()) return setMsg("Enter a name first.");
    setMsg("Scanning…");
    const faces = await eng.detectFaces();
    if (faces.length !== 1) return setMsg(faces.length ? "More than one face in frame — only the person being learned." : "No face found. Face the camera in good light.");
    eng.faces = await api("/api/faces", { json: { name: name.trim(), desc: faces[0].desc } });
    setMsg(`Learned ${name.trim()}. Capture 3–5 samples at different angles for best accuracy.`);
  }

  const s = hud?.stats;
  const cal = !s ? "" : s.calibState === 1 ? `Zeroing ${Math.round((hud!.prog || 0) * 100)}%` : s.calibState === 2 ? `Δ ${s.dev.toFixed(1)}%` : "Not zeroed";

  if (phase === "idle") return (
    <div className="center">
      <div className="aurora" /><div className="gridbg" />
      <div className="auth">
        <div style={{ display: "grid", justifyItems: "center", gap: 16, textAlign: "center" }}>
          <div className="mark lg"><Radar size={28} strokeWidth={2.2} /></div>
          <div><div className="h1" style={{ fontSize: 28 }}>Sentry mode</div><div className="mut">This device becomes the camera.</div></div>
        </div>
        <div className="card bullets" style={{ padding: 20 }}>
          <div><span className="n">1</span><div><b>Position it.</b> Prop the phone where it sees the room and plug it in.</div></div>
          <div><span className="n">2</span><div><b>Keep it open.</b> The screen stays awake; use Stealth to black it out.</div></div>
          <div><span className="n">3</span><div><b>Hold still.</b> The scene is zeroed automatically in the first 3 seconds.</div></div>
        </div>
        {err && <div className="card sm" style={{ color: "var(--bad)", borderColor: "rgba(251,113,133,.35)", padding: 14 }}>{err}</div>}
        <button className="btn pri lg" onClick={() => begin(facing)}><Radar size={18} />Activate sentry</button>
        <button className="btn ghost sm" style={{ justifySelf: "center" }} onClick={() => setFacing(facing === "environment" ? "user" : "environment")}>
          <RefreshCw size={14} /> Using {facing === "environment" ? "rear" : "front"} camera
        </button>
      </div>
      <video ref={videoRef} playsInline muted style={{ display: "none" }} />
    </div>
  );

  return (
    <div className="sentry">
      <div className="view" ref={viewRef}>
        <div className="frame" style={{ width: box.w, height: box.h }}>
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />
        </div>
      </div>
      <div className="shade" />
      <div className="topbar">
        <span className="brand" style={{ marginRight: 6 }}><span className="mark" style={{ width: 26, height: 26, borderRadius: 8 }}><Eye size={14} strokeWidth={2.4} /></span></span>
        <span className={`chip glass-chip ${hud?.armed ? "ok" : "warn"}`}><span className="dot pulse" />{hud?.armed ? "Armed" : "Disarmed"}</span>
        <span className={`chip glass-chip ${hud?.ready ? "" : "warn"}`}>{hud?.ready ? "AI online" : "Loading AI…"}</span>
        <span className={`chip glass-chip ${hud?.viewers ? "ac" : ""}`}>{hud?.link ? (hud.viewers ? `${hud.viewers} watching` : "Link ready") : "Link offline"}</span>
        {s && <span className="chip glass-chip mono">{cal}</span>}
        {s && s.light < 25 && <span className="chip glass-chip warn">Low light</span>}
      </div>
      {flash && <div className="chip bad flash" style={{ height: 34, fontSize: 13, background: "rgba(40,10,18,.8)", backdropFilter: "blur(14px)" }}><span className="dot" />{flash}</div>}
      <div className="dock">
        <div className="readouts">
          {[["Motion", s ? `${(s.motion * 100).toFixed(1)}%` : "–"], ["Light", s ? s.light.toFixed(0) : "–"], ["Sound", s ? (s.sound * 100).toFixed(1) : "–"], ["Tracked", s ? `${s.persons} · ${s.faces}` : "–"]].map(([k, v]) => (
            <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
          ))}
        </div>
        <div className="tools">
          <button className="tool pri" onClick={() => engineRef.current?.calibrate()}><span><Crosshair size={22} /></span>Zero</button>
          <button className="tool" onClick={() => { setSheet(true); setMsg(""); }}><span><ScanFace size={22} /></span>Learn face</button>
          <button className="tool" onClick={() => { const f = facing === "environment" ? "user" : "environment"; setFacing(f); begin(f); }}><span><RefreshCw size={22} /></span>Flip</button>
          <button className="tool" onClick={() => setStealth(true)}><span><EyeOff size={22} /></span>Stealth</button>
        </div>
      </div>
      {sheet && (
        <div className="sheet" onClick={() => setSheet(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <div className="row between"><div className="title" style={{ fontSize: 18 }}>Learn a face</div><button className="btn ghost icon sm" onClick={() => setSheet(false)}><X size={18} /></button></div>
            <div className="sm mut">One person in frame, facing the camera in good light. Capture 3–5 samples from slightly different angles.</div>
            <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn pri lg" onClick={learn}><ScanFace size={18} />Capture sample</button>
            {msg && <div className="sm mut" style={{ textAlign: "center" }}>{msg}</div>}
          </div>
        </div>
      )}
      {stealth && <div className="stealth" onClick={() => setStealth(false)}>Sentry active · tap to wake</div>}
    </div>
  );
}
