"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, getKey } from "@/lib/api";
import { playAlarm, unlockAudio } from "@/lib/alarm";
import { DEFAULT_SETTINGS, type ArgusEvent, type Face, type Heartbeat, type Settings } from "@/lib/types";

const COLORS: Record<string, string> = { person: "#ff3b5c", motion: "#ffb020", light: "#fff36b", sound: "#b06bff", change: "#00e5ff", face_unknown: "#ff3b5c", face_known: "#3bffb0" };
const ago = (ts: number) => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : new Date(ts).toLocaleString(); };

function Toggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return <button className={`sw ${on ? "on" : ""}`} onClick={() => set(!on)} aria-pressed={on} />;
}
function Slider({ label, value, min = 1, max = 10, unit = "", set }: { label: string; value: number; min?: number; max?: number; unit?: string; set: (v: number) => void }) {
  return <div className="row sm"><label className="dim">{label}</label><input type="range" min={min} max={max} value={value} onChange={(e) => set(+e.target.value)} /><span style={{ width: 38, textAlign: "right" }}>{value}{unit}</span></div>;
}

export default function Console() {
  const [engaged, setEngaged] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [events, setEvents] = useState<ArgusEvent[]>([]);
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [faces, setFaces] = useState<Face[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ img?: string; desc?: number[] } | null>(null);
  const [learnName, setLearnName] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [err, setErr] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const facesRev = useRef(-1);
  const editing = useRef(0);
  const prefs = useRef({ muted, volume });
  prefs.current = { muted, volume };

  useEffect(() => { if (!getKey()) location.href = "/"; }, []);

  const poll = useCallback(async () => {
    try {
      const s = await api<{ settings: Settings; events: ArgusEvent[]; hb: Heartbeat | null; facesRev: number }>("/api/state");
      if (Date.now() - editing.current > 3000) setSettings(s.settings);
      setHb(s.hb); setEvents(s.events); setErr("");
      if (s.facesRev !== facesRev.current) { facesRev.current = s.facesRev; setFaces(await api("/api/faces")); }
      const ids = new Set(s.events.map((e) => e.id));
      if (seen.current) {
        const news = s.events.filter((e) => !seen.current!.has(e.id));
        if (news.length) {
          setFresh(new Set(news.map((e) => e.id)));
          if (!prefs.current.muted) playAlarm(news.some((e) => e.type === "person" || e.type === "face_unknown") ? "critical" : "alert", prefs.current.volume);
          navigator.vibrate?.([300, 150, 300]);
          document.title = `⚠ ${news[0].label} — ARGUS`;
          if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("ARGUS", { body: news[0].label });
        }
      }
      seen.current = ids;
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => {
    if (!engaged) return;
    poll();
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 4000);
    const vis = () => { if (document.visibilityState === "visible") { document.title = "ARGUS"; poll(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [engaged, poll]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next); editing.current = Date.now();
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api("/api/settings", { json: next }).catch((e) => setErr(e.message)), 350);
  }

  async function expand(e: ArgusEvent) {
    setFresh(new Set());
    if (open === e.id) return setOpen(null);
    setOpen(e.id); setSnap(null); setLearnName("");
    if (e.snap) setSnap(await api(`/api/snap?id=${e.id}`));
  }
  async function learn() {
    if (!snap?.desc || !learnName.trim()) return;
    setFaces(await api("/api/faces", { json: { name: learnName.trim(), desc: snap.desc } }));
    setLearnName(""); setOpen(null);
  }

  const online = hb && Date.now() - hb.ts < 45000;
  const T = (k: "person" | "motion" | "light" | "sound" | "change", title: string, hint: string) => (
    <div className="panel" key={k}>
      <div className="row"><div><b>{title}</b><div className="dim sm">{hint}</div></div><Toggle on={settings[k].on} set={(on) => update({ [k]: { ...settings[k], on } })} /></div>
      {settings[k].on && <Slider label="Sensitivity" value={settings[k].sens} set={(sens) => update({ [k]: { ...settings[k], sens } })} />}
    </div>
  );

  if (!engaged) return (
    <div className="overlay">
      <h1>ARGUS</h1>
      <p className="dim">Tap to unlock alarm audio and alerts on this device.</p>
      <button className="big" onClick={() => { unlockAudio(); playAlarm("alert", 0.2); if (typeof Notification !== "undefined") Notification.requestPermission(); setEngaged(true); }}>Engage console</button>
    </div>
  );

  return (
    <div className="wrap">
      <h1>ARGUS</h1>
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="row"><span><span className={`dot ${online ? "on" : "off"}`} />SENTRY {online ? "ONLINE" : "OFFLINE"}</span>
          <span className="dim sm">{hb?.battery != null ? `🔋 ${Math.round(hb.battery * 100)}%${hb.charging ? " ⚡" : ""}` : ""}</span></div>
        <div className="row"><span className="dim sm">{hb ? `last seen ${ago(hb.ts)}` : "no camera has connected yet"}</span>
          <button className={settings.armed ? "warn" : "ok"} onClick={() => update({ armed: !settings.armed })}>{settings.armed ? "Disarm" : "Arm"}</button></div>
        {err && <div style={{ color: "var(--rd)" }} className="sm">{err}</div>}
      </div>

      <div className="panel">
        <h2>Alerts</h2>
        <div className="row"><button className="sm" onClick={() => playAlarm("critical", volume)}>Test alarm</button>
          <button className="sm" onClick={() => setMuted(!muted)}>{muted ? "Unmute" : "Mute"}</button>
          <button className="sm warn" onClick={async () => { await api("/api/events", { method: "DELETE" }); setEvents([]); }}>Clear</button></div>
        <Slider label="Volume" min={1} max={10} value={Math.round(volume * 10)} set={(v) => setVolume(v / 10)} />
        {events.map((e) => (
          <div key={e.id} className={`ev ${fresh.has(e.id) ? "new" : ""}`} style={{ borderLeftColor: COLORS[e.type] }} onClick={() => expand(e)}>
            <span className="badge" style={{ color: COLORS[e.type] }}>{e.type.replace("_", " ")}</span> {e.label}
            <div className="dim sm">{ago(e.ts)}</div>
            {open === e.id && (
              <div onClick={(x) => x.stopPropagation()}>
                {snap?.img ? <img className="snap" src={snap.img} alt="snapshot" /> : <div className="dim sm">{e.snap ? "Loading…" : "No snapshot"}</div>}
                {snap?.desc && (
                  <div className="row">
                    <input type="text" placeholder="Who is this? Learn face as…" value={learnName} onChange={(x) => setLearnName(x.target.value)} />
                    <button className="sm ok" onClick={learn}>Learn</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!events.length && <div className="dim sm">All quiet.</div>}
      </div>

      <h2>Detection</h2>
      {T("person", "Humans", "AI person detection")}
      {T("motion", "Movement", "Any motion in frame")}
      {T("light", "Light change", "Lights on/off, flashlight")}
      {T("sound", "Sound", "Noise spikes via microphone")}
      {T("change", "Any change", "Scene differs from baseline (door opened, object moved)")}
      <div className="panel">
        <div className="row"><div><b>Unknown faces</b><div className="dim sm">Alert when a face isn&apos;t in the learned list</div></div><Toggle on={settings.faceUnknown.on} set={(on) => update({ faceUnknown: { on } })} /></div>
        <div className="row"><div><b>Known faces</b><div className="dim sm">Also alert when someone you taught it appears</div></div><Toggle on={settings.faceKnown.on} set={(on) => update({ faceKnown: { on } })} /></div>
      </div>
      <div className="panel">
        <Slider label="Cooldown between alerts" min={2} max={120} unit="s" value={settings.cooldown} set={(cooldown) => update({ cooldown })} />
        <Slider label="Arm delay (time to leave room)" min={0} max={120} unit="s" value={settings.armDelay} set={(armDelay) => update({ armDelay })} />
        <div className="row sm"><label className="dim">Attach snapshots</label><Toggle on={settings.snapshots} set={(snapshots) => update({ snapshots })} /></div>
      </div>

      <div className="panel">
        <h2>Known faces</h2>
        {faces.map((f) => (
          <div className="row" key={f.id}><span>{f.name} <span className="dim sm">({f.descs.length} samples)</span></span>
            <button className="sm warn" onClick={async () => setFaces(await api(`/api/faces?id=${f.id}`, { method: "DELETE" }))}>Remove</button></div>
        ))}
        {!faces.length && <div className="dim sm">None yet. Teach faces from the Sentry page, or tap an &quot;unknown face&quot; alert above.</div>}
      </div>
    </div>
  );
}
