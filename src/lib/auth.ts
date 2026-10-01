import { timingSafeEqual } from "crypto";

// Shared access key: set ARGUS_KEY in Vercel. Dev falls back to "argus".
export function checkKey(req: Request): Response | null {
  const key = process.env.ARGUS_KEY || (process.env.NODE_ENV !== "production" ? "argus" : "");
  if (!key) return Response.json({ error: "ARGUS_KEY is not set on the server" }, { status: 503 });
  const given = req.headers.get("x-argus-key") ?? "";
  const a = Buffer.from(given), b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
