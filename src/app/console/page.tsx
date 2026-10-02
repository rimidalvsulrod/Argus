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
  person: { c: "#f43f5e", Icon: PersonStanding, name: "Human" },
  face_unknown: { c: "#f43f5e", Icon: UserX, name: "Unknown face" },
  face_known: { c: "#10b981", Icon: UserCheck, name: "Known face" },
  motion: { c: "#f59e0b", Icon: Activity, name: "Motion" },
  light: { c: "#eab308", Icon: Lightbulb, name: "Light" },
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
    <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
      <div className="row between sm"><span className="mut">{label}</span><span className="mono">{fmt ? fmt(value) : value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(+e.target.value)} />
    </div>
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
      <div className="bg-grid" />
      <div className="auth" style={{ position: "relative", textAlign: "center", justifyItems: "center" }}>
        <div className="hero-mark"><Radar size={26} /></div>
        <div><div style={{ fontSize: 22, fontWeight: 700, letterSpacing: ".14em" }}>CONSOLE</div><div className="mut">Tap to enable alarm sound and notifications on this device.</div></div>
        <button className="btn pri lg" onClick={() => { unlockAudio(); playAlarm("alert", 0.15); if (typeof Notification !== "undefined") Notification.requestPermission(); setEngaged(true); }}>Engage console</button>
      </div>
    </div>
  );

  // ---------- sections ----------
  const live = (
    <div className="grid2">
      <div className="stack">
        <div ref={stageRef} className={`stage ${hasStream ? "scan" : ""}`} style={{ aspectRatio: ratio }}>
          <video ref={videoRef} playsInline autoPlay muted onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setRatio(v.videoWidth / v.videoHeight); }} style={{ display: hasStream ? "block" : "none" }} />
          {!hasStream && hb?.thumb && online && <img src={hb.thumb} alt="Latest frame" />}
          <canvas ref={canvasRef} />
          {!hasStream && !(hb?.thumb && online) && (
            <div className="empty"><div><Radar size={30} style={{ opacity: .5 }} /><div style={{ marginTop: 8 }}>{online ? "Connecting to sentry…" : "Sentry offline"}</div><div className="sm dim">{online ? "Establishing peer link" : "Open /camera on the phone and tap Activate"}</div></div></div>
          )}
          <div className="hud">
            {hasStream ? <span className="pill bad"><span className="dot pulse" />Live</span>
              : online && hb?.thumb ? <span className="pill warn">Relay · {ago(hb.ts)}</span>
              : <span className="pill">{link === "connecting" ? "Connecting" : "No signal"}</span>}
            {st && <span className="pill mono">{st.persons} body · {st.faces} face</span>}
            {st && st.light < 25 && <span className="pill warn">Low light</span>}
          </div>
          <div className="corner">
            <button className="btn icon" title="Overlay" onClick={() => setOverlay(!overlay)}>{overlay ? <Eye size={16} /> : <EyeOff size={16} />}</button>
            <button className="btn icon" title="Listen" onClick={() => setListen(!listen)} disabled={!hasStream}>{listen ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
            <button className="btn icon" title="Fullscreen" onClick={() => stageRef.current?.requestFullscreen?.()}><Maximize2 size={16} /></button>
          </div>
        </div>
        <div className="stats">
          {[["Motion", st ? `${(st.motion * 100).toFixed(1)}%` : "–"], ["Light", st ? st.light.toFixed(0) : "–"], ["Sound", st ? (st.sound * 100).toFixed(1) : "–"], ["Deviation", st?.calibState === 2 ? `${st.dev.toFixed(1)}%` : "–"]].map(([k, v]) => (
            <div className="stat" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
          ))}
        </div>
        {!hasStream && online && <div className="sm dim">Live video uses a direct peer-to-peer link. If it can&apos;t connect (some mobile networks block it), you&apos;ll see a relay frame refreshed every 15s.</div>}
      </div>
      <div className="stack">
        {calibCard()}
        <div className="card">
          <div className="card-h"><div className="card-t"><Bell size={14} />Recent</div><button className="btn ghost sm" onClick={() => go("alerts")}>View all</button></div>
          {events.slice(0, 4).map((e) => evRow(e, false))}
          {!events.length && <div className="sm dim">All quiet.</div>}
        </div>
      </div>
    </div>
  );

  function calibCard() {
    const dev = st?.calibState === 2 ? st.dev : 0;
    const trip = settings.calib.trip;
    const max = Math.max(10, trip * 2.5);
    const col = dev > trip ? "var(--bad)" : dev > trip * 0.6 ? "var(--warn)" : "var(--ok)";
    const status = !st ? "Waiting for sentry" : st.calibState === 1 ? `Learning zero point…${hasStream ? ` ${Math.round(prog * 100)}%` : ""}` : st.calibState === 2 ? `Zeroed ${ago(st.calibAt)}` : "Not zeroed";
    return (
      <div className="card">
        <div className="card-h">
          <div className="card-t"><Crosshair size={14} />Calibrate</div>
          <Toggle on={settings.calib.on} set={(on) => update({ calib: { ...settings.calib, on } })} />
        </div>
        <div className="row between" style={{ alignItems: "flex-end" }}>
          <div><div className="big" style={{ color: st?.calibState === 2 ? col : "var(--dim)" }}>{st?.calibState === 2 ? dev.toFixed(1) : "—"}<span style={{ fontSize: 16, color: "var(--mut)" }}>%</span></div><div className="xs mut" style={{ marginTop: 4 }}>deviation from zero</div></div>
          <button className="btn pri" onClick={zero} disabled={!online}><Crosshair size={16} />Set zero</button>
        </div>
        <div className="gauge" style={{ marginTop: 16 }}>
          <i style={{ width: `${Math.min(100, (dev / max) * 100)}%`, background: col }} />
          <b style={{ left: `calc(${(trip / max) * 100}% - 1px)` }} title="Trip point" />
        </div>
        <div className="row between xs dim mono" style={{ marginTop: 6 }}><span>0</span><span>trip {trip}%</span><span>{max.toFixed(0)}%</span></div>
        <div className="sm mut" style={{ marginTop: 10 }}>{status}</div>
        <Range label="Trip point" value={trip} min={0.5} max={25} step={0.5} fmt={(v) => `${v}%`} set={(v) => update({ calib: { ...settings.calib, trip: v } })} />
        <div className="xs dim" style={{ marginTop: 10 }}>Set zero with the room as it should be. Anything that changes the scene beyond the trip point — a door opening, an object moved, a light — triggers an alert.</div>
      </div>
    );
  }

  function evRow(e: ArgusEvent, expandable: boolean) {
    const m = META[e.type] ?? META.motion;
    return (
      <div key={e.id} className={`ev ${fresh.has(e.id) ? "new" : ""}`} onClick={() => (expandable ? expand(e) : go("alerts"))}>
        <div className="ev-ic" style={{ background: `${m.c}1f`, color: m.c }}><m.Icon size={17} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
          <div className="xs mut">{m.name} · {clock(e.ts)}</div>
        </div>
        <div className="xs dim mono">{ago(e.ts)}</div>
        {expandable && open === e.id && (
          <div className="ev-body" onClick={(x) => x.stopPropagation()}>
            {snap?.img ? <img src={snap.img} alt="Snapshot" /> : <div className="sm dim">{e.snap ? "Loading snapshot…" : "No snapshot"}</div>}
            {snap?.desc && (
              <div className="row" style={{ marginTop: 10 }}>
                <input className="input" placeholder="Who is this? Name to learn this face" value={learnName} onChange={(x) => setLearnName(x.target.value)} />
                <button className="btn good" onClick={learn}><ScanFace size={16} />Learn</button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const alerts = (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="card-h"><div className="card-t"><Bell size={14} />Alarm</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => playAlarm("critical", volume)}>Test</button>
            <button className="btn sm" onClick={() => setMuted(!muted)}>{muted ? <><BellOff size={14} />Muted</> : <><Bell size={14} />Sound on</>}</button>
          </div>
        </div>
        <Range label="Volume" value={Math.round(volume * 100)} min={10} max={100} step={10} fmt={(v) => `${v}%`} set={(v) => setVolume(v / 100)} />
      </div>
      <div className="row between"><div className="card-t">{events.length} events</div>
        {!!events.length && <button className="btn danger sm" onClick={async () => { await api("/api/events", { method: "DELETE" }); setEvents([]); }}><Trash2 size={14} />Clear</button>}</div>
      <div>{events.map((e) => evRow(e, true))}</div>
      {!events.length && <div className="card sm dim" style={{ textAlign: "center", padding: 30 }}>No alerts yet.</div>}
    </div>
  );

  const det = (k: "person" | "motion" | "light" | "sound", Icon: typeof Activity, title: string, hint: string) => (
    <div className="card" key={k}>
      <div className="row">
        <div className="ev-ic" style={{ background: "var(--s2)", color: settings[k].on ? "var(--ac)" : "var(--dim)" }}><Icon size={17} /></div>
        <div className="grow"><div style={{ fontWeight: 600 }}>{title}</div><div className="sm mut">{hint}</div></div>
        <Toggle on={settings[k].on} set={(on) => update({ [k]: { ...settings[k], on } })} />
      </div>
      {settings[k].on && <Range label="Sensitivity" value={settings[k].sens} min={1} max={10} fmt={(v) => (v <= 3 ? `${v} · low` : v >= 8 ? `${v} · high` : `${v}`)} set={(sens) => update({ [k]: { ...settings[k], sens } })} />}
    </div>
  );
  const detect = (
    <div className="stack" style={{ maxWidth: 760 }}>
      {det("person", PersonStanding, "Humans", "AI body tracking (skeleton). Confirmed across frames.")}
      {det("motion", Activity, "Movement", "Coherent moving regions; ignores sensor noise and exposure shifts.")}
      {det("light", Lightbulb, "Light change", "Lights switched on/off, flashlights, headlights.")}
      {det("sound", Mic, "Sound", "Sustained noise or sharp impacts (knocks, bangs, glass).")}
      <div className="card">
        <div className="row"><div className="ev-ic" style={{ background: "var(--s2)", color: settings.faceUnknown.on ? "var(--ac)" : "var(--dim)" }}><UserX size={17} /></div>
          <div className="grow"><div style={{ fontWeight: 600 }}>Unknown faces</div><div className="sm mut">Faces not in your learned list (confirmed twice).</div></div>
          <Toggle on={settings.faceUnknown.on} set={(on) => update({ faceUnknown: { on } })} /></div>
        <div className="sep" />
        <div className="row"><div className="ev-ic" style={{ background: "var(--s2)", color: settings.faceKnown.on ? "var(--ac)" : "var(--dim)" }}><UserCheck size={17} /></div>
          <div className="grow"><div style={{ fontWeight: 600 }}>Known faces</div><div className="sm mut">Also notify when someone you taught it appears.</div></div>
          <Toggle on={settings.faceKnown.on} set={(on) => update({ faceKnown: { on } })} /></div>
      </div>
      <div className="card">
        <div className="card-t"><Settings2 size={14} />General</div>
        <Range label="Cooldown between alerts of the same type" value={settings.cooldown} min={2} max={120} fmt={(v) => `${v}s`} set={(cooldown) => update({ cooldown })} />
        <Range label="Arm delay (time to leave the room)" value={settings.armDelay} min={0} max={120} fmt={(v) => `${v}s`} set={(armDelay) => update({ armDelay })} />
        <div className="row between" style={{ marginTop: 14 }}><span className="sm mut">Attach snapshots to alerts</span><Toggle on={settings.snapshots} set={(snapshots) => update({ snapshots })} /></div>
      </div>
    </div>
  );

  const facesTab = (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="card">
        <div className="card-h"><div className="card-t"><Users size={14} />Known faces</div><span className="xs dim">{faces.length} people</span></div>
        {faces.map((f) => (
          <div className="row between" key={f.id} style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
            <div className="row"><div className="ev-ic" style={{ background: "rgba(16,185,129,.12)", color: "var(--ok)" }}><UserCheck size={17} /></div>
              <div><div style={{ fontWeight: 500 }}>{f.name}</div><div className="xs mut">{f.descs.length} sample{f.descs.length === 1 ? "" : "s"}{f.descs.length < 3 ? " · add more for accuracy" : ""}</div></div></div>
            <button className="btn danger sm" onClick={async () => setFaces(await api(`/api/faces?id=${f.id}`, { method: "DELETE" }))}><Trash2 size={14} /></button>
          </div>
        ))}
        {!faces.length && <div className="sm dim">Nobody learned yet.</div>}
      </div>
      <div className="card sm mut" style={{ display: "grid", gap: 6 }}>
        <div><b style={{ color: "var(--tx)" }}>Teach a face:</b> on the Sentry phone tap <i>Learn face</i>, or open an <i>Unknown face</i> alert here and name it.</div>
        <div>3–5 samples per person from different angles gives reliable recognition. Distant faces are shown but not judged.</div>
      </div>
    </div>
  );

  return (
    <>
      <div className="top">
        <div className="top-in">
          <div className="brand"><div className="brand-mark"><Eye size={15} /></div>ARGUS</div>
          <div className="grow" />
          <span className={`pill ${online ? "ok" : "bad"}`}><span className={`dot ${online ? "pulse" : ""}`} />{online ? "Online" : "Offline"}</span>
          {hb?.battery != null && <span className="pill mono">{Math.round(hb.battery * 100)}%{hb.charging ? " ⚡" : ""}</span>}
          <button className={`btn sm ${settings.armed ? "danger" : "good"}`} onClick={() => update({ armed: !settings.armed })}>
            {settings.armed ? <><Shield size={14} />Armed</> : <><ShieldOff size={14} />Disarmed</>}
          </button>
        </div>
      </div>
      <div className="shell">
        <div className="tabs">
          {([["live", "Live", Radar], ["alerts", "Alerts", Bell], ["detect", "Detection", Settings2], ["faces", "Faces", Users]] as const).map(([k, l, I]) => (
            <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => go(k)}><I size={15} />{l}{k === "alerts" && unseen > 0 && <span className="count">{unseen}</span>}</button>
          ))}
        </div>
        {err && <div className="card sm" style={{ color: "var(--bad)", borderColor: "rgba(244,63,94,.4)", marginBottom: 14 }}>{err}</div>}
        {tab === "live" ? live : tab === "alerts" ? alerts : tab === "detect" ? detect : facesTab}
      </div>
      {toast && (
        <div className="toast" onClick={() => { setToast(null); go("alerts"); }}>
          <div className="ev-ic" style={{ background: "rgba(244,63,94,.18)", color: "var(--bad)" }}>{(() => { const I = (META[toast.type] ?? META.motion).Icon; return <I size={18} />; })()}</div>
          <div className="grow"><div style={{ fontWeight: 600 }}>{toast.label}</div><div className="xs mut">{clock(toast.ts)} · tap to view</div></div>
        </div>
      )}
    </>
  );
}
