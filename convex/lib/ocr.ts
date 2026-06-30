/**
 * OCR via Mistral (`mistral-ocr-latest`), ported from Albo's extract-pdf /
 * extract-image steps. Pure fetch (runs in the default Convex runtime).
 *
 * Both helpers are resilient: on any failure (incl. missing MISTRAL_API_KEY)
 * they log and return '' so report ingestion still succeeds on the email body.
 */

const OCR_URL = 'https://api.mistral.ai/v1/ocr'

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000 // avoid call-stack overflow on large files
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function callOcr(
  document: Record<string, string>,
  label: string,
): Promise<string> {
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) {
    console.warn('[ocr] MISTRAL_API_KEY missing — skipping OCR')
    return ''
  }
  try {
    const res = await fetch(OCR_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'mistral-ocr-latest', document }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      console.warn(`[ocr] ${label}: Mistral ${res.status}`)
      return ''
    }
    const data = (await res.json()) as { pages?: Array<{ markdown?: string }> }
    return (data.pages ?? [])
      .map((p) => p.markdown ?? '')
      .join('\n\n---\n\n')
      .trim()
  } catch (err) {
    console.warn(
      `[ocr] ${label} failed:`,
      err instanceof Error ? err.message : String(err),
    )
    return ''
  }
}

/** Extract text from a PDF. */
export function extractPdfText(bytes: ArrayBuffer, fileName: string): Promise<string> {
  const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(bytes)}`
  return callOcr({ type: 'document_url', document_url: dataUrl }, fileName)
}

/** Extract text from an image (screenshots, charts…). */
export function extractImageText(
  bytes: ArrayBuffer,
  mime: string,
  fileName: string,
): Promise<string> {
  const dataUrl = `data:${mime};base64,${arrayBufferToBase64(bytes)}`
  return callOcr({ type: 'image_url', image_url: dataUrl }, fileName)
}

/** Routing helper: returns OCR text for PDF/image attachments, '' otherwise. */
export function ocrAttachment(
  bytes: ArrayBuffer,
  filename: string,
  contentType: string | undefined,
): Promise<string> {
  const ct = (contentType ?? '').toLowerCase()
  const name = filename.toLowerCase()
  if (ct.includes('pdf') || name.endsWith('.pdf')) {
    return extractPdfText(bytes, filename)
  }
  if (ct.startsWith('image/') || /\.(png|jpe?g|webp|gif|tiff?)$/.test(name)) {
    return extractImageText(bytes, ct || 'image/png', filename)
  }
  return Promise.resolve('')
}
