/**
 * DocSend link → PDF bytes for the report content router, via the public
 * docsend2pdf.com conversion API (no key — per validated decision, cf.
 * `reportExtract.ts`). Returns null on any failure: a failed DocSend source
 * is a NOMINAL outcome for the router, never fatal.
 */

export async function downloadDocSend(
  url: string,
  email: string,
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('https://docsend2pdf.com/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, email }),
    })
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}
