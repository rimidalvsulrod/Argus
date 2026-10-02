"use client";
import { useState } from "react";
import { ArrowRight, ChevronRight, Eye, MonitorSmartphone, Radar } from "lucide-react";
import { api, getKey, setKey } from "@/lib/api";

export default function Home() {
  const [key, setK] = useState(() => getKey());
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [persist, setPersist] = useState(true);

  async function login(e?: React.FormEvent) {
    e?.preventDefault();
    setKey(key); setBusy(true);
    try { const r = await api<{ persistent: boolean }>("/api/auth", { json: {} }); setPersist(r.persistent); setAuthed(true); setErr(""); }
    catch (x: any) { setErr(x.message === "unauthorized" ? "That key didn't work." : x.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="center">
      <div className="aurora" /><div className="gridbg" />
      <div className="auth">
        <div style={{ display: "grid", justifyItems: "center", gap: 18, textAlign: "center", marginBottom: 6 }}>
          <div className="mark lg"><Eye size={28} strokeWidth={2.2} /></div>
          <div>
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.03em" }}>Argus</div>
            <div className="mut" style={{ marginTop: 2 }}>The hundred-eyed watcher for your home.</div>
          </div>
        </div>
        {!authed ? (
          <form className="card" style={{ display: "grid", gap: 14, padding: 22 }} onSubmit={login}>
            <div className="eyebrow">Access key</div>
            <input className="input" type="password" placeholder="Enter key" autoFocus value={key} onChange={(e) => setK(e.target.value)} />
            {err && <div className="sm" style={{ color: "var(--bad)" }}>{err}</div>}
            <button className="btn pri lg" disabled={busy}>{busy ? "Verifying…" : <>Continue <ArrowRight size={18} /></>}</button>
          </form>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {!persist && (
              <div className="card sm" style={{ borderColor: "rgba(251,191,36,.3)", color: "var(--warn)", padding: 14 }}>
                No database connected — alerts won&apos;t persist reliably. Add Upstash Redis in Vercel → Storage.
              </div>
            )}
            <a className="choice" href="/camera">
              <div className="ci"><Radar size={22} /></div>
              <div><div className="title">Sentry</div><div className="sm mut">Use this device as the camera</div></div>
              <ChevronRight size={18} className="dim" />
            </a>
            <a className="choice" href="/console">
              <div className="ci" style={{ background: "rgba(129,140,248,.1)", color: "var(--ac-2)", borderColor: "rgba(129,140,248,.25)" }}><MonitorSmartphone size={22} /></div>
              <div><div className="title">Console</div><div className="sm mut">Live view, alerts and controls</div></div>
              <ChevronRight size={18} className="dim" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
