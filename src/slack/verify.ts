const MAX_SKEW_SECONDS = 5 * 60;

/**
 * Verify a Slack request signature (v0 HMAC-SHA256 over `v0:timestamp:body`).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export async function verifySlackSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowMs: number;
}): Promise<boolean> {
  const { secret, timestamp, signature, body, nowMs } = input;
  if (secret.length === 0 || timestamp === null || signature === null) return false;
  if (!/^\d{1,20}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  if (Math.abs(nowMs / 1000 - seconds) > MAX_SKEW_SECONDS) return false;
  const expected = `v0=${await hmacSha256Hex(secret, `v0:${timestamp}:${body}`)}`;
  return fixedTimeEqual(expected, signature);
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(new Uint8Array(mac));
}

/**
 * Compare two strings without short-circuiting on the first difference.
 * Both values are hashed to a fixed length first so the comparison does not
 * leak the length of the expected signature. Uses Web Crypto's
 * timingSafeEqual when this runtime provides it.
 */
export async function fixedTimeEqual(expected: string, provided: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [expectedHash, providedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(expectedHash, providedHash);
  }
  const left = new Uint8Array(expectedHash);
  const right = new Uint8Array(providedHash);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
