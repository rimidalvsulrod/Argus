"use client";
import { useState } from "react";
import { ChevronRight, Eye, MonitorSmartphone, Radar } from "lucide-react";
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
    catch (x: any) { setErr(x.message === "unauthorized" ? "Access denied — wrong key." : x.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="center">
      <div className="bg-grid" />
      <div className="auth" style={{ position: "relative" }}>
        <div className="hero-mark"><Eye size={26} /></div>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: ".18em" }}>ARGUS</div>
          <div className="mut">Hundred-eyed home tripwire</div>
        </div>
        {!authed ? (
          <form className="card" style={{ display: "grid", gap: 12 }} onSubmit={login}>
            <label className="sm mut" htmlFor="k">Access key</label>
            <input id="k" className="input" type="password" autoFocus value={key} onChange={(e) => setK(e.target.value)} />
            {err && <div className="sm" style={{ color: "var(--bad)" }}>{err}</div>}
            <button className="btn pri lg" disabled={busy}>{busy ? "Verifying…" : "Unlock"}</button>
          </form>
        ) : (
          <>
            {!persist && (
              <div className="card sm" style={{ borderColor: "rgba(245,158,11,.4)", color: "var(--warn)" }}>
                No database connected — alerts won&apos;t persist reliably. Add Upstash Redis in Vercel → Storage.
              </div>
            )}
            <a className="choice" href="/camera">
              <div className="ic"><Radar size={22} /></div>
              <div><div style={{ fontWeight: 600 }}>Sentry</div><div className="sm mut">Run on the camera phone</div></div>
              <ChevronRight size={18} className="dim" />
            </a>
            <a className="choice" href="/console">
              <div className="ic"><MonitorSmartphone size={22} /></div>
              <div><div style={{ fontWeight: 600 }}>Console</div><div className="sm mut">Live feed, alerts &amp; settings</div></div>
              <ChevronRight size={18} className="dim" />
            </a>
          </>
        )}
      </div>
    </div>
  );
}
