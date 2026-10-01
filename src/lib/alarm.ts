"use client";
// Sci-fi klaxon synthesized with WebAudio (no audio files). Must be unlocked by a user tap.
let ctx: AudioContext | null = null;
export function unlockAudio() {
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
}
export function playAlarm(kind: "alert" | "critical" = "alert", volume = 0.8) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sawtooth";
  o.connect(g).connect(out);
  const sweeps = kind === "critical" ? 6 : 3;
  for (let i = 0; i < sweeps; i++) {
    o.frequency.setValueAtTime(500, t0 + i * 0.5);
    o.frequency.exponentialRampToValueAtTime(1100, t0 + i * 0.5 + 0.45);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05);
  g.gain.setValueAtTime(0.5, t0 + sweeps * 0.5 - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + sweeps * 0.5);
  o.start(t0);
  o.stop(t0 + sweeps * 0.5 + 0.05);
}
