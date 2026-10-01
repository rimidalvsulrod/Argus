"use client";
import { useState } from "react";
import { api, getKey, setKey } from "@/lib/api";

export default function Home() {
  const [key, setK] = useState(() => getKey());
  const [authed, setAuthed] = useState(false);
  const [err, setErr] = useState("");
  const [persist, setPersist] = useState(true);

  async function login() {
    setKey(key);
    try { const r = await api<{ persistent: boolean }>("/api/auth", { json: {} }); setPersist(r.persistent); setAuthed(true); setErr(""); }
    catch (e: any) { setErr(e.message === "unauthorized" ? "ACCESS DENIED" : e.message); }
  }
  return (
    <div className="wrap" style={{ paddingTop: 60 }}>
      <h1>ARGUS</h1>
      <p className="dim">// hundred-eyed tripwire</p>
      {!authed ? (
        <div className="panel grid">
          <h2>Authenticate</h2>
          <input type="password" placeholder="ACCESS KEY" value={key} onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          <button className="big" onClick={login}>Engage</button>
          {err && <div style={{ color: "var(--rd)" }}>{err}</div>}
        </div>
      ) : (
        <div className="grid">
          {!persist && <div className="panel sm" style={{ borderColor: "var(--am)", color: "var(--am)" }}>No Redis configured: state lives in server memory and will not survive serverless restarts. Add Upstash Redis in Vercel (see README).</div>}
          <a href="/camera"><button className="big">Sentry — run on camera phone</button></a>
          <a href="/console"><button className="big ok">Console — alerts &amp; settings</button></a>
        </div>
      )}
    </div>
  );
}
