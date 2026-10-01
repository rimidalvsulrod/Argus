import { timingSafeEqual } from "crypto";

// Shared access key: set ARGUS_KEY in Vercel. Defaults to "123" when unset.
export function checkKey(req: Request): Response | null {
  const key = process.env.ARGUS_KEY || "123";
  const given = req.headers.get("x-argus-key") ?? "";
  const a = Buffer.from(given), b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
