/**
 * HMAC verification for incoming webhooks (n8n → Convex).
 *
 * ⚠️ Convex httpActions run in the default Convex runtime (V8 isolate), NOT
 * Node — `node:crypto` / `crypto.timingSafeEqual` are unavailable and an
 * httpAction cannot be `"use node"`. We therefore use Web Crypto
 * (`crypto.subtle`) plus a constant-time string compare implemented by hand.
 *
 * Contract: the caller signs the raw request body with HMAC-SHA256 and a
 * shared secret, and sends the lowercase hex digest in a header. We recompute
 * and compare in constant time. Fails closed if the header or secret is absent.
 */
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyHmac(
  body: string,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const expected = toHex(new Uint8Array(sig))
  return constantTimeEqual(expected, signatureHeader.trim().toLowerCase())
}
