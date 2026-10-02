import { checkKey } from "@/lib/auth";
import { heartbeat } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  const b = await req.json().catch(() => ({}));
  return Response.json(await heartbeat({
    ts: Date.now(), battery: b.battery, charging: b.charging, stats: b.stats, peer: b.peer, token: b.token,
    thumb: typeof b.thumb === "string" && b.thumb.length < 200_000 ? b.thumb : undefined,
  }));
}
