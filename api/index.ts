
// api/index.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    method: req.method,
    path: req.url,
    note: "Hello from Vercel Serverless Function",
  });
}
