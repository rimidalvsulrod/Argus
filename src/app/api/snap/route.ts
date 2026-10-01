import { checkKey } from "@/lib/auth";
import { getSnap } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return Response.json((await getSnap(id)) ?? {});
}
