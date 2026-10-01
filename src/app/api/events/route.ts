import { checkKey } from "@/lib/auth";
import { addEvent, clearEvents } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  const b = await req.json();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hasSnap = !!(b.img || b.desc);
  await addEvent(
    { id, ts: b.ts ?? Date.now(), type: b.type, label: String(b.label ?? b.type).slice(0, 80), conf: b.conf, snap: hasSnap },
    hasSnap ? { img: b.img, desc: b.desc } : undefined,
  );
  return Response.json({ ok: true, id });
}
export async function DELETE(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  await clearEvents();
  return Response.json({ ok: true });
}
