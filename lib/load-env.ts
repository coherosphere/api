// lib/load-env.ts
// Lädt .env.local NUR lokal (nicht in der Vercel-Cloud)
if (!process.env.VERCEL) {
  try {
    const path = require("path");
    const envPath = path.join(process.cwd(), ".env.local");
    require("dotenv").config({ path: envPath });
  } catch {}
}
