import { checkKey } from "@/lib/auth";
import { getState } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return checkKey(req) ?? Response.json({ ...(await getState()), now: Date.now() });
}
