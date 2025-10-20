import { verifyEvent } from "nostr-tools";
import { createHash } from "crypto";

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export type Nip98Result =
  | { ok: true; pubkey: string }
  | { ok: false; error: string; status?: number };

export async function verifyNip98({
  reqUrl,
  method,
  authHeader,
  bodyRaw, // string | undefined
}: {
  reqUrl: string;
  method: string;
  authHeader?: string;
  bodyRaw?: string;
}): Promise<Nip98Result> {
  if (!authHeader?.startsWith("Nostr ")) {
    return { ok: false, error: "Missing Authorization header", status: 401 };
  }

  try {
    const b64 = authHeader.slice("Nostr ".length).trim();
    const json = Buffer.from(b64, "base64").toString("utf8");
    const event = JSON.parse(json);

    // Pflichtfelder laut NIP-98:
    // kind 27235, leeres content, Tags: ["u", "<absolute url>"], ["method", "<HTTP verb>"]
    // payload-Tag empfohlen bei Body-Methoden
    if (event.kind !== 27235) return { ok: false, error: "Invalid kind", status: 401 };

    // Zeitfenster (60s empfohlen)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(event.created_at)) > 60) {
      return { ok: false, error: "Stale signature", status: 401 };
    }

    const u = event.tags.find((t: string[]) => t[0] === "u")?.[1];
    const m = event.tags.find((t: string[]) => t[0] === "method")?.[1];
    if (!u || !m) return { ok: false, error: "Missing tags", status: 401 };

    // Absolute URL muss exakt passen (inkl. Query)
    if (u !== reqUrl) return { ok: false, error: "URL mismatch", status: 401 };
    if (m.toUpperCase() !== method.toUpperCase()) return { ok: false, error: "Method mismatch", status: 401 };

    // Payload-Hash prüfen, falls vorhanden
    const payload = event.tags.find((t: string[]) => t[0] === "payload")?.[1];
    if (payload && bodyRaw !== undefined) {
      const hash = sha256Hex(bodyRaw);
      if (hash !== payload) return { ok: false, error: "Payload hash mismatch", status: 401 };
    }

    // Signatur prüfen
    const valid = verifyEvent(event);
    if (!valid) return { ok: false, error: "Invalid signature", status: 401 };

    return { ok: true, pubkey: event.pubkey };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Bad auth event", status: 400 };
  }
}
