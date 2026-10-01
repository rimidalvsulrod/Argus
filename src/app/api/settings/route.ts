import { checkKey } from "@/lib/auth";
import { saveSettings } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const bad = checkKey(req); if (bad) return bad;
  return Response.json(await saveSettings(await req.json()));
}
