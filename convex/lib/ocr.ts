/**
 * PDF / image text extraction via the Mistral OCR API (mistral-ocr-latest).
 *
 * One clean path: the configured chat model (OpenRouter/DeepSeek) does not
 * accept PDF inputs, so document reading goes through Mistral OCR — the
 * proven choice on real reports. Returns '' on any failure (missing key,
 * API error, unreadable file): extraction steps never throw, the router
 * records the failed state instead.
 */

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr'

async function mistralOcr(dataUrl: string, docType: 'document_url' | 'image_url'): Promise<string> {
  const key = process.env.MISTRAL_API_KEY
  if (!key) {
    console.warn('[ocr] MISTRAL_API_KEY not set — skipping OCR')
    return ''
  }
  try {
    const res = await fetch(MISTRAL_OCR_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document:
          docType === 'document_url'
            ? { type: 'document_url', document_url: dataUrl }
            : { type: 'image_url', image_url: dataUrl },
      }),
    })
    if (!res.ok) {
      console.warn(`[ocr] Mistral OCR status=${res.status}`)
      return ''
    }
    const data = (await res.json()) as { pages?: Array<{ markdown: string }> }
    return (data.pages ?? []).map((p) => p.markdown).join('\n\n---\n\n')
  } catch (err) {
    console.warn('[ocr] failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export async function ocrPdf(buf: ArrayBuffer): Promise<string> {
  return mistralOcr(`data:application/pdf;base64,${toBase64(buf)}`, 'document_url')
}

export async function ocrImage(buf: ArrayBuffer, mime: string): Promise<string> {
  return mistralOcr(`data:${mime};base64,${toBase64(buf)}`, 'image_url')
}
