// api/auth/session.ts
import "../../lib/load-env"; // lädt .env.local nur lokal (nicht in Vercel-Prod)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { verifyNip98 } from "../../lib/nip98";
import { getRedis } from "../../lib/redis";
import { randomUUID } from "crypto";

/**
 * ENVs
 * APP_ORIGINS     Kommagetrennte Liste erlaubter Origins
 * NODE_ENV        production | development
 * SESSION_TTL_SEC optional, default 7 Tage
 */
const ORIGINS = (process.env.APP_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

const isProd = process.env.NODE_ENV === "production";
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 24 * 7);
const COOKIE_NAME = "sid";

/* -------------------- Helpers -------------------- */

function pickAllowedOrigin(req: VercelRequest): string {
  const reqOrigin = String(req.headers.origin ?? "");
  if (ORIGINS.includes(reqOrigin)) return reqOrigin;
  return ORIGINS[0] ?? "*";
}

function cors(res: VercelResponse, req: VercelRequest) {
  const allow = pickAllowedOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
}

function getCookie(req: VercelRequest, name: string) {
  const raw = req.headers.cookie ?? "";
  const hit = raw.split("; ").find((s: string) => s.startsWith(name + "="));
  return hit ? decodeURIComponent(hit.split("=")[1]) : undefined;
}

function eTLD(host: string) {
  const h = host.split(":")[0]; // Port entfernen
  const parts = h.split(".");
  return parts.slice(-2).join(".");
}

function isCrossSite(reqHost: string, allowedOrigin: string) {
  const apiSite = eTLD(reqHost || "");
  const appSite = eTLD(new URL(allowedOrigin).host);
  return apiSite !== appSite; // z.B. .io vs .com => true
}

function setCookie(res: VercelResponse, sid: string, maxAge: number, reqHost: string, allowedOrigin: string) {
  const cross = isCrossSite(reqHost, allowedOrigin);
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(sid)}`,
    "Path=/",
    "HttpOnly",
    cross ? "SameSite=None" : "SameSite=Lax", // Cross-Site braucht None
    `Max-Age=${maxAge}`,
  ];
  if (isProd) attrs.push("Secure"); // nur Prod
  // keine Domain setzen -> Host-Only Cookie (nur api.coherosphere.io)
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearCookie(res: VercelResponse, reqHost: string, allowedOrigin: string) {
  const cross = isCrossSite(reqHost, allowedOrigin);
  const attrs = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    cross ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProd) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function absoluteUrl(req: VercelRequest) {
  const host = String(req.headers.host || "");
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${req.url}`;
}

/* -------------------- Handler -------------------- */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();

  const url = absoluteUrl(req);
  const host = String(req.headers.host || "");
  const allowedOrigin = pickAllowedOrigin(req);

  const bodyRaw =
    typeof req.body === "string" ? req.body : req.body ? JSON.stringify(req.body) : undefined;

  if (req.method === "POST") {
    // NIP-98 prüfen
    const auth = req.headers.authorization as string | undefined;
    const v = await verifyNip98({
      reqUrl: url,
      method: "POST",
      authHeader: auth,
      bodyRaw,
    });
    if (!v.ok) return res.status(v.status ?? 401).json({ ok: false, error: v.error });

    // Session speichern
    const redis = getRedis();
    const sid = randomUUID();
    await redis.hset(`session:${sid}`, { pubkey: v.pubkey, iat: Date.now().toString() });
    await redis.expire(`session:${sid}`, SESSION_TTL_SEC);

    setCookie(res, sid, SESSION_TTL_SEC, host, allowedOrigin);
    return res.status(201).json({ ok: true, pubkey: v.pubkey });
  }

  if (req.method === "GET") {
    const sid = getCookie(req, COOKIE_NAME);
    if (!sid) return res.status(401).json({ ok: false, error: "No session" });

    const redis = getRedis();
    const data = await redis.hgetall<Record<string, string>>(`session:${sid}`);
    if (!data?.pubkey) return res.status(401).json({ ok: false, error: "Invalid session" });

    return res.status(200).json({ ok: true, pubkey: data.pubkey });
  }

  if (req.method === "DELETE") {
    const sid = getCookie(req, COOKIE_NAME);
    if (sid) {
      const redis = getRedis();
      await redis.del(`session:${sid}`);
    }
    clearCookie(res, host, allowedOrigin);
    return res.status(200).json({ ok: true, loggedOut: true });
  }

  res.setHeader("Allow", "GET,POST,DELETE,OPTIONS");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
