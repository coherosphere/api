import "../lib/load-env"; // <<< erste Zeile
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    hasUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    appOrigin: process.env.APP_ORIGIN,
    cookieDomain: process.env.COOKIE_DOMAIN,
    nodeEnv: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL
  });
}
