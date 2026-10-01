"use client";
export const getKey = () => (typeof localStorage === "undefined" ? "" : localStorage.getItem("argus-key") ?? "");
export const setKey = (k: string) => localStorage.setItem("argus-key", k);

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    headers: { "content-type": "application/json", "x-argus-key": getKey(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (r.status === 401) {
    if (typeof location !== "undefined") location.href = "/";
    throw new Error("unauthorized");
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
  return r.json();
}
