"use client";
// Peer-to-peer live link (WebRTC via PeerJS's free signalling server). Video never touches our backend/Redis.
// The sentry publishes a random peer id + token through the authenticated heartbeat; viewers must present the
// token on their data connection before the sentry calls them back with the camera stream.
import type { DataConnection, MediaConnection, Peer } from "peerjs";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }],
};
// Optional self-hosted PeerJS server (defaults to the free 0.peerjs.com cloud).
const HOST = process.env.NEXT_PUBLIC_PEER_HOST;
const SERVER = HOST ? { host: HOST, port: Number(process.env.NEXT_PUBLIC_PEER_PORT || 443), path: process.env.NEXT_PUBLIC_PEER_PATH || "/", secure: process.env.NEXT_PUBLIC_PEER_SECURE !== "false" } : {};
const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

export type Msg =
  | { t: "tele"; d: unknown }
  | { t: "ev" }
  | { t: "calibrate"; at: number }
  | { t: "settings"; s: unknown };

export class SentryLink {
  id = `argus-${rand(10)}`;
  token = rand(16);
  online = false;
  private peer?: Peer;
  private calls = new Map<DataConnection, MediaConnection>();
  constructor(private stream: MediaStream, private onMsg: (m: Msg) => void) {}

  get viewers() { return this.calls.size; }

  async start() {
    const { Peer } = await import("peerjs");
    const peer = new Peer(this.id, { ...SERVER, config: ICE, debug: 0 });
    this.peer = peer;
    peer.on("open", () => (this.online = true));
    peer.on("disconnected", () => { this.online = false; setTimeout(() => !peer.destroyed && peer.reconnect(), 2000); });
    peer.on("error", (e) => console.warn("link", e.type));
    peer.on("connection", (conn) => {
      if ((conn.metadata as { token?: string })?.token !== this.token) { conn.on("open", () => conn.close()); return; }
      const drop = () => { this.calls.get(conn)?.close(); this.calls.delete(conn); };
      conn.on("open", () => this.calls.set(conn, peer.call(conn.peer, this.stream)));
      conn.on("data", (m) => this.onMsg(m as Msg));
      conn.on("close", drop);
      conn.on("error", drop);
    });
  }
  setStream(s: MediaStream) {
    this.stream = s;
    for (const [conn, call] of this.calls) { call.close(); this.calls.set(conn, this.peer!.call(conn.peer, s)); }
  }
  send(m: Msg) {
    for (const c of this.calls.keys()) if (c.open) try { c.send(m); } catch {}
  }
  stop() { this.peer?.destroy(); }
}

export type LinkState = "idle" | "connecting" | "live" | "failed";

export class ViewerLink {
  state: LinkState = "idle";
  private peer?: Peer;
  private conn?: DataConnection;
  private target = "";
  constructor(private cb: { stream: (s: MediaStream | null) => void; msg: (m: Msg) => void; state: (s: LinkState) => void }) {}

  private set(s: LinkState) { this.state = s; this.cb.state(s); }

  // Idempotent: call on every poll; (re)connects when the sentry id changes or the link dropped.
  async ensure(id: string, token: string) {
    if (this.target === id && (this.state === "live" || this.state === "connecting")) return;
    this.conn?.close();
    this.target = id;
    this.set("connecting");
    const { Peer } = await import("peerjs");
    if (!this.peer || this.peer.destroyed) {
      const peer = new Peer({ ...SERVER, config: ICE, debug: 0 });
      peer.on("call", (call) => {
        call.answer();
        call.on("stream", (s) => { this.cb.stream(s); this.set("live"); });
        call.on("close", () => this.cb.stream(null));
      });
      peer.on("disconnected", () => setTimeout(() => !peer.destroyed && peer.reconnect(), 2000));
      this.peer = peer;
    }
    const peer = this.peer;
    const go = () => {
      const conn = peer.connect(id, { metadata: { token }, serialization: "json" });
      this.conn = conn;
      const fail = () => { if (this.conn !== conn) return; this.conn = undefined; this.target = ""; this.cb.stream(null); this.set("failed"); };
      conn.on("data", (m) => this.cb.msg(m as Msg));
      conn.on("close", fail);
      conn.on("error", fail);
      setTimeout(() => { if (this.conn === conn && this.state === "connecting") { conn.close(); fail(); } }, 15000);
    };
    if (peer.open) go(); else peer.once("open", go);
  }
  send(m: Msg) { if (this.conn?.open) try { this.conn.send(m); } catch {} }
  close() { this.peer?.destroy(); this.peer = undefined; this.target = ""; }
}
