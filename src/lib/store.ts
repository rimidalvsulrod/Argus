import { Redis } from "@upstash/redis";
import { DEFAULT_SETTINGS, type ArgusEvent, type Face, type Heartbeat, type Settings } from "./types";

// Upstash Redis in production (Vercel Marketplace sets KV_REST_API_*); in-memory fallback for local dev.
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

const g = globalThis as unknown as { __argus?: Map<string, unknown> };
const mem = (g.__argus ??= new Map<string, unknown>());

async function get<T>(k: string): Promise<T | null> {
  if (redis) return (await redis.get<T>(k)) ?? null;
  return (mem.get(k) as T) ?? null;
}
async function set(k: string, v: unknown, ex?: number) {
  if (redis) await redis.set(k, v, ex ? { ex } : undefined);
  else mem.set(k, v);
}
async function del(k: string) {
  if (redis) await redis.del(k);
  else mem.delete(k);
}

export const usingRedis = !!redis;

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await get<Settings>("argus:settings")) ?? {}) };
}
export async function saveSettings(patch: Partial<Settings>) {
  const next = { ...(await getSettings()), ...patch };
  await set("argus:settings", next);
  return next;
}

// Everything the console polls, in one round trip.
export async function getState() {
  if (redis) {
    const [settings, events, hb, rev] = await redis.mget<[Settings | null, ArgusEvent[] | null, Heartbeat | null, number | null]>(
      "argus:settings", "argus:events", "argus:hb", "argus:facesrev",
    );
    return { settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, events: events ?? [], hb, facesRev: rev ?? 0 };
  }
  return {
    settings: await getSettings(),
    events: (await get<ArgusEvent[]>("argus:events")) ?? [],
    hb: await get<Heartbeat>("argus:hb"),
    facesRev: (await get<number>("argus:facesrev")) ?? 0,
  };
}

export async function heartbeat(hb: Heartbeat) {
  await set("argus:hb", hb, 120);
  const [settings, rev] = redis
    ? await redis.mget<[Settings | null, number | null]>("argus:settings", "argus:facesrev")
    : [await get<Settings>("argus:settings"), await get<number>("argus:facesrev")];
  return { settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, facesRev: rev ?? 0 };
}

export async function addEvent(e: ArgusEvent, snap?: { img?: string; desc?: number[] }) {
  if (snap && (snap.img || snap.desc)) await set(`argus:snap:${e.id}`, snap, 60 * 60 * 24 * 3);
  const list = (await get<ArgusEvent[]>("argus:events")) ?? [];
  const next = [e, ...list].slice(0, 40);
  await set("argus:events", next);
}
export async function getSnap(id: string) {
  return get<{ img?: string; desc?: number[] }>(`argus:snap:${id}`);
}
export async function clearEvents() {
  await set("argus:events", []);
}

export async function getFaces(): Promise<Face[]> {
  return (await get<Face[]>("argus:faces")) ?? [];
}
export async function saveFaces(f: Face[]) {
  await set("argus:faces", f);
  await set("argus:facesrev", Date.now());
}
