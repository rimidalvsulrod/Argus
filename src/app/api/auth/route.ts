import { checkKey } from "@/lib/auth";
import { usingRedis } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  return checkKey(req) ?? Response.json({ ok: true, persistent: usingRedis });
}
