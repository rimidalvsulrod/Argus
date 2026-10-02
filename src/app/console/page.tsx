"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, Bell, BellOff, Crosshair, Eye, EyeOff, Lightbulb, Maximize2, Mic, PersonStanding, Radar, ScanFace,
  Settings2, Shield, ShieldOff, Trash2, UserCheck, UserX, Users, Volume2, VolumeX, Waves,
} from "lucide-react";
import { api, getKey } from "@/lib/api";
import { playAlarm, unlockAudio } from "@/lib/alarm";
import { paint, type Scene } from "@/lib/overlay";
import { ViewerLink, type LinkState, type Msg } from "@/lib/rtc";
import { DEFAULT_SETTINGS, type ArgusEvent, type Face, type Heartbeat, type Settings, type Stats } from "@/lib/types";

type Tele = { scene: Scene; stats: Stats; prog: number; armed: boolean; ready: boolean };
type Tab = "live" | "alerts" | "detect" | "faces";

const META: Record<string, { c: string; Icon: typeof Activity; name: string }> = {
  person: { c: "#fb7185", Icon: PersonStanding, name: "Human" },
  face_unknown: { c: "#fb7185", Icon: UserX, name: "Unknown face" },
  face_known: { c: "#34d399", Icon: UserCheck, name: "Known face" },
  motion: { c: "#fbbf24", Icon: Activity, name: "Motion" },
  light: { c: "#facc15", Icon: Lightbulb, name: "Light" },
  sound: { c: "#a78bfa", Icon: Waves, name: "Sound" },
  change: { c: "#22d3ee", Icon: Crosshair, name: "Deviation" },
};
const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(ts).toLocaleDateString();
};
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return <button className={`sw ${on ? "on" : ""}`} onClick={() => set(!on)} aria-pressed={on} />;
}
function Range({ label, value, min, max, step = 1, fmt, set }: { label: string; value: number; min: number; max: number; step?: number; fmt?: (v: number) => string; set: (v: number) => void }) {
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 14 }}>
      <div className="row between sm"><span className="mut">{label}</span><span className="mono" style={{ fontSize: 12.5 }}>{fmt ? fmt(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(+e.target.value)}
        style={{ "--p": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
    </div>
  );
}
// 240° radial gauge with a trip marker
function Gauge({ value, trip, max, color, active }: { value: number; trip: number; max: number; color: string; active: boolean }) {
  const cx = 120, cy = 118, R = 96, A0 = 150, SW = 240;
  const pt = (f: number, r = R) => { const a = ((A0 + SW * f) * Math.PI) / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (f0: number, f1: number) => { const [x0, y0] = pt(f0), [x1, y1] = pt(f1); return `M ${x0} ${y0} A ${R} ${R} 0 ${SW * (f1 - f0) > 180 ? 1 : 0} 1 ${x1} ${y1}`; };
  const f = Math.min(1, Math.max(0.001, value / max)), ft = Math.min(1, trip / max);
  const [tx0, ty0] = pt(ft, R - 16), [tx1, ty1] = pt(ft, R + 16);
  return (
    <svg viewBox="0 0 240 205">
      <defs>
        <linearGradient id="gg" x1="0" x2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor={color} /></linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      {Array.from({ length: 41 }, (_, i) => { const [a, b] = pt(i / 40, R + 14), [c, d] = pt(i / 40, R + (i % 5 ? 18 : 22)); return <line key={i} x1={a} y1={b} x2={c} y2={d} stroke="rgba(255,255,255,.14)" strokeWidth={i % 5 ? 1 : 1.6} />; })}
      <path d={arc(0, 1)} stroke="rgba(255,255,255,.07)" strokeWidth="12" fill="none" strokeLinecap="round" />
      {active && <path d={arc(0, f)} stroke={color} strokeWidth="12" fill="none" strokeLinecap="round" filter="url(#glow)" opacity=".55" />}
      {active && <path d={arc(0, f)} stroke="url(#gg)" strokeWidth="12" fill="none" strokeLinecap="round" style={{ transition: "d .25s" }} />}
      <line x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function Console() {
  const [engaged, setEngaged] = useState(false);
  const [tab, setTab] = useState<Tab>("live");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [events, setEvents] = useState<ArgusEvent[]>([]);
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [faces, setFaces] = useState<Face[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ img?: string; desc?: number[] } | null>(null);
  const [learnName, setLearnName] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [unseen, setUnseen] = useState(0);
  const [toast, setToast] = useState<ArgusEvent | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [err, setErr] = useState("");
  const [link, setLink] = useState<LinkState>("idle");
  const [hasStream, setHasStream] = useState(false);
  const [tele, setTele] = useState<Tele | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [listen, setListen] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);

  const seen = useRef<Set<string> | null>(null);
  const facesRev = useRef(-1);
  const editing = useRef(0);
  const prefs = useRef({ muted, volume });
  prefs.current = { muted, volume };
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const teleRef = useRef<Tele | null>(null);
  const linkRef = useRef<ViewerLink | null>(null);
  const pollRef = useRef<() => void>(() => {});
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { if (!getKey()) location.href = "/"; }, []);

  const poll = useCallback(async () => {
    try {
      const s = await api<{ settings: Settings; events: ArgusEvent[]; hb: Heartbeat | null; facesRev: number; now: number }>("/api/state");
      if (Date.now() - editing.current > 3000) setSettings(s.settings);
      setHb(s.hb); setEvents(s.events); setErr("");
      if (s.hb?.peer && s.hb.token && Date.now() - s.hb.ts < 45000) linkRef.current?.ensure(s.hb.peer, s.hb.token);
      if (s.facesRev !== facesRev.current) { facesRev.current = s.facesRev; setFaces(await api("/api/faces")); }
      if (seen.current) {
        const news = s.events.filter((e) => !seen.current!.has(e.id));
        if (news.length) {
          setFresh(new Set(news.map((e) => e.id)));
          setUnseen((n) => n + news.length);
          setToast(news[0]);
          clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), 8000);
          if (!prefs.current.muted) playAlarm(news.some((e) => e.type === "person" || e.type === "face_unknown") ? "critical" : "alert", prefs.current.volume);
          navigator.vibrate?.([300, 150, 300]);
          document.title = `⚠ ${news[0].label} — ARGUS`;
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") new Notification("ARGUS", { body: news[0].label });
        }
      }
      seen.current = new Set(s.events.map((e) => e.id));
    } catch (e: any) { setErr(e.message); }
  }, []);
  pollRef.current = poll;

  // live link
  useEffect(() => {
    if (!engaged) return;
    const l = new ViewerLink({
      stream: (s) => {
        streamRef.current = s; setHasStream(!!s);
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
      },
      msg: (m: Msg) => {
        if (m.t === "tele") { teleRef.current = m.d as Tele; setTele(m.d as Tele); }
        if (m.t === "ev") pollRef.current();
      },
      state: setLink,
    });
    linkRef.current = l;
    return () => l.close();
  }, [engaged]);

  // polling (slower while the live link delivers alerts instantly)
  useEffect(() => {
    if (!engaged) return;
    poll();
    let t: ReturnType<typeof setTimeout>;
    const loop = () => { t = setTimeout(() => { if (document.visibilityState === "visible") poll(); loop(); }, linkRef.current?.state === "live" ? 12000 : 4000); };
    loop();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => { if (document.visibilityState === "visible") { document.title = "ARGUS"; poll(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(t); clearInterval(tick); document.removeEventListener("visibilitychange", vis); };
  }, [engaged, poll]);

  // attach stream when the live tab mounts; draw overlay
  useEffect(() => {
    if (tab !== "live") return;
    const v = videoRef.current;
    if (v && streamRef.current && v.srcObject !== streamRef.current) { v.srcObject = streamRef.current; v.play().catch(() => {}); }
    let raf = 0;
    const draw = () => {
      if (canvasRef.current) paint(canvasRef.current, overlay && hasStream ? teleRef.current?.scene ?? null : null);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tab, overlay, hasStream]);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = !listen; }, [listen, hasStream, tab]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    editing.current = Date.now();
    linkRef.current?.send({ t: "settings", s: next }); // instant on the sentry when linked
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api("/api/settings", { json: next }).catch((e) => setErr(e.message)), 300);
  }
  function zero() {
    const at = Date.now();
    linkRef.current?.send({ t: "calibrate", at });
    update({ calib: { ...settings.calib, at } });
  }

  async function expand(e: ArgusEvent) {
    if (open === e.id) return setOpen(null);
    setOpen(e.id); setSnap(null); setLearnName("");
    if (e.snap) setSnap(await api(`/api/snap?id=${e.id}`));
  }
  async function learn() {
    if (!snap?.desc || !learnName.trim()) return;
    setFaces(await api("/api/faces", { json: { name: learnName.trim(), desc: snap.desc } }));
    setLearnName(""); setOpen(null);
  }
  function go(t: Tab) { setTab(t); if (t === "alerts") { setUnseen(0); setFresh(new Set()); } }

  const online = !!hb && now - hb.ts < 45000;
  const st: Stats | undefined = (hasStream && tele?.stats) || hb?.stats;
  const prog = hasStream ? tele?.prog ?? 0 : 0;

  if (!engaged) return (
    <div className="center">
      <div className="aurora" /><div className="gridbg" />
      <div className="auth" style={{ textAlign: "center", justifyItems: "center" }}>
        <div className="mark lg"><Eye size={28} strokeWidth={2.2} /></div>
        <div><div className="h1" style={{ fontSize: 28 }}>Console</div><div className="mut" style={{ maxWidth: 320 }}>Tap once to enable alarm sound and notifications on this device.</div></div>
        <button className="btn pri lg" onClick={() => { unlockAudio(); playAlarm("alert", 0.15); if (typeof Notification !== "undefined") Notification.requestPermission(); setEngaged(true); }}>Engage console</button>
      </div>
    </div>
  );

  const TABS = [["live", "Live", Radar], ["alerts", "Alerts", Bell], ["detect", "Detection", Settings2], ["faces", "Faces", Users]] as const;
  const tiles: [string, typeof Activity, string, number][] = [
    ["Motion", Activity, st ? `${(st.motion * 100).toFixed(1)}%` : "—", st ? Math.min(1, st.motion / 0.2) : 0],
    ["Light", Lightbulb, st ? st.light.toFixed(0) : "—", st ? st.light / 255 : 0],
    ["Sound", Waves, st ? (st.sound * 100).toFixed(1) : "—", st ? Math.min(1, st.sound / 0.3) : 0],
    ["Tracked", PersonStanding, st ? `${st.persons} · ${st.faces}` : "—", st ? Math.min(1, (st.persons + st.faces) / 4) : 0],
  ];

  function calibCard() {
    const zeroed = st?.calibState === 2;
    const dev = zeroed ? st!.dev : 0;
    const trip = settings.calib.trip;
    const max = Math.max(10, trip * 2.5);
    const col = dev > trip ? "#fb7185" : dev > trip * 0.6 ? "#fbbf24" : "#34d399";
    const status = !st ? "Waiting for sentry" : st.calibState === 1 ? `Learning zero point${hasStream ? ` · ${Math.round(prog * 100)}%` : "…"}` : zeroed ? `Zeroed ${ago(st.calibAt)}` : "Not zeroed";
    return (
      <div className="card">
        <div className="card-h">
          <div className="eyebrow"><Crosshair size={13} />Calibration</div>
          <Toggle on={settings.calib.on} set={(on) => update({ calib: { ...settings.calib, on } })} />
        </div>
        <div className="gauge-wrap">
          <Gauge value={dev} trip={trip} max={max} color={col} active={zeroed} />
          <div className="gauge-val">
            <div><span className="n" style={{ color: zeroed ? "var(--tx)" : "var(--dim)" }}>{zeroed ? dev.toFixed(1) : "—"}</span><span className="u">%</span></div>
            <div className="xs mut" style={{ marginTop: 6 }}>deviation from zero</div>
          </div>
        </div>
        <div className="row between" style={{ marginTop: 4 }}>
          <span className={`chip ${!st ? "" : st.calibState === 1 ? "ac" : zeroed ? (dev > trip ? "bad" : "ok") : "warn"}`}>
            {st?.calibState === 1 && <span className="dot pulse" />}{status}
          </span>
          <button className="btn pri" onClick={zero} disabled={!online}><Crosshair size={16} />Set zero</button>
        </div>
        <Range label="Trip point" value={trip} min={0.5} max={25} step={0.5} fmt={(v) => `${v}%`} set={(v) => update({ calib: { ...settings.calib, trip: v } })} />
        <div className="xs dim" style={{ marginTop: 12, lineHeight: 1.55 }}>Zero the room as it should be. Any change beyond the trip point — a door, a moved object, a light — raises an alert.</div>
      </div>
    );
  }

  function evRow(e: ArgusEvent, expandable: boolean) {
    const m = META[e.type] ?? META.motion;
    return (
      <div key={e.id} className={`ev ${fresh.has(e.id) ? "new" : ""} ${expandable && open === e.id ? "open" : ""}`} onClick={() => (expandable ? expand(e) : go("alerts"))}>
        <div className="ic" style={{ background: `${m.c}18`, color: m.c, boxShadow: `inset 0 0 0 1px ${m.c}30` }}><m.Icon size={18} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
          <div className="xs mut">{m.name} · {clock(e.ts)}</div>
        </div>
        <div className="xs dim mono">{ago(e.ts)}</div>
        {expandable && open === e.id && (
          <div className="ev-body" onClick={(x) => x.stopPropagation()}>
            {snap?.img ? <img src={snap.img} alt="Snapshot" /> : <div className="sm dim">{e.snap ? "Loading snapshot…" : "No snapshot for this alert."}</div>}
            {snap?.desc && (
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <input className="input" style={{ height: 40 }} placeholder="Name this person to learn their face" value={learnName} onChange={(x) => setLearnName(x.target.value)} />
                <button className="btn good" style={{ height: 40 }} onClick={learn}><ScanFace size={16} />Learn</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const live = (
    <div className="layout">
      <div className="stack">
        <div ref={stageRef} className="stage" style={{ aspectRatio: ratio }}>
          <video ref={videoRef} playsInline autoPlay muted onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setRatio(v.videoWidth / v.videoHeight); }} style={{ display: hasStream ? "block" : "none" }} />
          {!hasStream && hb?.thumb && online && <img src={hb.thumb} alt="Latest frame" />}
          <canvas ref={canvasRef} />
          {!hasStream && !(hb?.thumb && online) && (
            <div className="empty"><div>
              <div className="radar" />
              <div className="title">{online ? "Connecting to sentry" : "Sentry offline"}</div>
              <div className="sm dim" style={{ marginTop: 4 }}>{online ? "Establishing a secure peer link…" : "Open Sentry on the camera phone and tap Activate."}</div>
            </div></div>
          )}
          <div className="hud">
            {hasStream ? <span className="chip bad"><span className="dot pulse" />Live</span>
              : online && hb?.thumb ? <span className="chip warn">Relay · {ago(hb.ts)}</span>
              : <span className="chip">{link === "connecting" ? "Connecting…" : "No signal"}</span>}
            {st && st.light < 25 && <span className="chip warn">Low light</span>}
          </div>
          {hasStream && <div className="meta">{new Date(now).toLocaleTimeString()}</div>}
          <div className="corner">
            <button className="btn icon sm" title="Tracking overlay" onClick={() => setOverlay(!overlay)}>{overlay ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button className="btn icon sm" title="Listen" onClick={() => setListen(!listen)} disabled={!hasStream}>{listen ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>
            <button className="btn icon sm" title="Fullscreen" onClick={() => stageRef.current?.requestFullscreen?.()}><Maximize2 size={15} /></button>
          </div>
        </div>
        <div className="tiles">
          {tiles.map(([k, I, v, f]) => (
            <div className="tile" key={k}><div className="k"><I size={13} />{k}</div><div className="v">{v}</div><div className="bar"><i style={{ width: `${f * 100}%` }} /></div></div>
          ))}
        </div>
        {!hasStream && online && <div className="xs dim">Live video is a direct peer-to-peer link. If your network blocks it, a relay frame refreshes every 15 seconds instead.</div>}
      </div>
      <div className="stack">
        {calibCard()}
        <div className="card" style={{ padding: 10 }}>
          <div className="card-h" style={{ padding: "6px 8px 0" }}><div className="eyebrow"><Bell size={13} />Recent activity</div><button className="btn ghost sm" onClick={() => go("alerts")}>View all</button></div>
          <div className="list">{events.slice(0, 4).map((e) => evRow(e, false))}</div>
          {!events.length && <div className="sm dim" style={{ padding: "8px 10px 12px" }}>All quiet.</div>}
        </div>
      </div>
    </div>
  );

  const alerts = (
    <div className="stack narrow">
      <div className="card">
        <div className="card-h" style={{ marginBottom: 4 }}>
          <div><div className="title">Alarm</div><div className="xs mut">Plays on this device when an alert arrives</div></div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => playAlarm("critical", volume)}>Test</button>
            <button className={`btn sm ${muted ? "danger" : ""}`} onClick={() => setMuted(!muted)}>{muted ? <><BellOff size={14} />Muted</> : <><Bell size={14} />On</>}</button>
          </div>
        </div>
        <Range label="Volume" value={Math.round(volume * 100)} min={10} max={100} step={10} fmt={(v) => `${v}%`} set={(v) => setVolume(v / 100)} />
      </div>
      <div className="card" style={{ padding: 10 }}>
        <div className="card-h" style={{ padding: "6px 8px 0" }}>
          <div className="eyebrow">{events.length} events</div>
          {!!events.length && <button className="btn danger sm" onClick={async () => { await api("/api/events", { method: "DELETE" }); setEvents([]); }}><Trash2 size={14} />Clear</button>}
        </div>
        <div className="list">{events.map((e) => evRow(e, true))}</div>
        {!events.length && <div style={{ textAlign: "center", padding: "40px 10px" }}><Bell size={26} className="dim" /><div className="mut" style={{ marginTop: 8 }}>No alerts yet</div></div>}
      </div>
    </div>
  );

  const det = (k: "person" | "motion" | "light" | "sound", Icon: typeof Activity, title: string, hint: string) => (
    <div className="card" key={k}>
      <div className="row">
        <div className="ic" style={{ background: settings[k].on ? "rgba(34,211,238,.1)" : "var(--glass-2)", color: settings[k].on ? "var(--ac)" : "var(--dim)" }}><Icon size={18} /></div>
        <div className="grow"><div className="title">{title}</div><div className="sm mut">{hint}</div></div>
        <Toggle on={settings[k].on} set={(on) => update({ [k]: { ...settings[k], on } })} />
      </div>
      {settings[k].on && <Range label="Sensitivity" value={settings[k].sens} min={1} max={10} fmt={(v) => (v <= 3 ? `Low · ${v}` : v >= 8 ? `High · ${v}` : `Medium · ${v}`)} set={(sens) => update({ [k]: { ...settings[k], sens } })} />}
    </div>
  );
  const faceRow = (on: boolean, set: (v: boolean) => void, Icon: typeof Activity, title: string, hint: string) => (
    <div className="row">
      <div className="ic" style={{ background: on ? "rgba(34,211,238,.1)" : "var(--glass-2)", color: on ? "var(--ac)" : "var(--dim)" }}><Icon size={18} /></div>
      <div className="grow"><div className="title">{title}</div><div className="sm mut">{hint}</div></div>
      <Toggle on={on} set={set} />
    </div>
  );
  const detect = (
    <div className="stack narrow">
      {det("person", PersonStanding, "Humans", "Skeleton tracking, confirmed across frames")}
      {det("motion", Activity, "Movement", "Coherent moving regions; ignores noise and exposure shifts")}
      {det("light", Lightbulb, "Light change", "Lights on or off, flashlights, headlights")}
      {det("sound", Mic, "Sound", "Sustained noise or sharp impacts")}
      <div className="card">
        {faceRow(settings.faceUnknown.on, (on) => update({ faceUnknown: { on } }), UserX, "Unknown faces", "Anyone not in your known list")}
        <div className="divider" />
        {faceRow(settings.faceKnown.on, (on) => update({ faceKnown: { on } }), UserCheck, "Known faces", "Also notify when someone you know appears")}
      </div>
      <div className="card">
        <div className="title">General</div>
        <Range label="Cooldown between alerts of the same type" value={settings.cooldown} min={2} max={120} fmt={(v) => `${v}s`} set={(cooldown) => update({ cooldown })} />
        <Range label="Arm delay" value={settings.armDelay} min={0} max={120} fmt={(v) => `${v}s`} set={(armDelay) => update({ armDelay })} />
        <div className="divider" />
        <div className="row between"><div><div style={{ fontWeight: 550 }}>Snapshots</div><div className="xs mut">Attach an annotated frame to each alert</div></div><Toggle on={settings.snapshots} set={(snapshots) => update({ snapshots })} /></div>
      </div>
    </div>
  );

  const facesTab = (
    <div className="stack narrow">
      <div className="card" style={{ padding: 10 }}>
        <div className="card-h" style={{ padding: "6px 8px 0" }}><div className="eyebrow"><Users size={13} />Known people</div><span className="xs dim">{faces.length}</span></div>
        {faces.map((f) => (
          <div className="ev" key={f.id} style={{ cursor: "default" }}>
            <div className="ic" style={{ background: "rgba(52,211,153,.1)", color: "var(--ok)", fontWeight: 650 }}>{f.name.slice(0, 1).toUpperCase()}</div>
            <div><div style={{ fontWeight: 550 }}>{f.name}</div><div className="xs mut">{f.descs.length} sample{f.descs.length === 1 ? "" : "s"}{f.descs.length < 3 ? " · add more for accuracy" : ""}</div></div>
            <button className="btn ghost icon sm" title="Remove" onClick={async () => setFaces(await api(`/api/faces?id=${f.id}`, { method: "DELETE" }))}><Trash2 size={15} /></button>
          </div>
        ))}
        {!faces.length && <div style={{ textAlign: "center", padding: "36px 10px" }}><ScanFace size={26} className="dim" /><div className="mut" style={{ marginTop: 8 }}>Nobody learned yet</div></div>}
      </div>
      <div className="card bullets">
        <div><span className="n">1</span><div><b>On the sentry</b>, tap Learn face with one person in frame.</div></div>
        <div><span className="n">2</span><div><b>Or from an alert</b> — open an Unknown face alert and name it.</div></div>
        <div><span className="n">3</span><div><b>3–5 samples</b> per person from different angles gives reliable recognition.</div></div>
      </div>
    </div>
  );

  return (
    <>
      <div className="top">
        <div className="top-in">
          <div className="brand"><div className="mark"><Eye size={16} strokeWidth={2.4} /></div>Argus</div>
          <div className="grow" />
          <div className="seg">
            {TABS.map(([k, l, I]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}><I size={15} />{l}{k === "alerts" && unseen > 0 && <span className="count">{unseen}</span>}</button>
            ))}
          </div>
          <div className="grow" />
          <span className={`chip ${online ? "ok" : "bad"}`}><span className={`dot ${online ? "pulse" : ""}`} />{online ? "Online" : "Offline"}{hb?.battery != null && online && <span className="mono" style={{ opacity: .8 }}>· {Math.round(hb.battery * 100)}%{hb.charging ? "⚡" : ""}</span>}</span>
          <button className={`btn sm ${settings.armed ? "danger" : "good"}`} onClick={() => update({ armed: !settings.armed })}>
            {settings.armed ? <><Shield size={14} />Armed</> : <><ShieldOff size={14} />Disarmed</>}
          </button>
        </div>
      </div>
      <div className="shell">
        {err && <div className="card sm" style={{ color: "var(--bad)", borderColor: "rgba(251,113,133,.35)", marginBottom: 16, padding: 14 }}>{err}</div>}
        {tab === "live" ? live : tab === "alerts" ? alerts : tab === "detect" ? detect : facesTab}
      </div>
      <nav className="mobile-tabs">
        {TABS.map(([k, l, I]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => go(k)}><I size={20} />{l}{k === "alerts" && unseen > 0 && <span className="count">{unseen}</span>}</button>
        ))}
      </nav>
      {toast && (
        <div className="toast" onClick={() => { setToast(null); go("alerts"); }}>
          <div className="ic" style={{ background: "rgba(251,113,133,.18)", color: "var(--bad)" }}>{(() => { const I = (META[toast.type] ?? META.motion).Icon; return <I size={19} />; })()}</div>
          <div className="grow"><div style={{ fontWeight: 600 }}>{toast.label}</div><div className="xs mut">{clock(toast.ts)} · tap to review</div></div>
        </div>
      )}
    </>
  );
}
