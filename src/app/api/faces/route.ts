import { checkKey } from "@/lib/auth";
import { getFaces, saveFaces } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return checkKey(req) ?? Response.json(await getFaces());
}
// Add a descriptor sample to a named person (creates them if new).
export async function POST(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  const { name, desc } = await req.json();
  if (!name || !Array.isArray(desc) || desc.length !== 128) return Response.json({ error: "bad input" }, { status: 400 });
  const faces = await getFaces();
  const n = String(name).trim().slice(0, 40);
  let f = faces.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (!f) faces.push((f = { id: Math.random().toString(36).slice(2, 9), name: n, descs: [] }));
  f.descs = [...f.descs, desc].slice(-12);
  await saveFaces(faces);
  return Response.json(faces);
}
export async function DELETE(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  const id = new URL(req.url).searchParams.get("id");
  const faces = (await getFaces()).filter((f) => f.id !== id);
  await saveFaces(faces);
  return Response.json(faces);
}
