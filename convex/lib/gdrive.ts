/**
 * Google Drive link → file bytes for the report content router (brick 4).
 *
 * The headers are read BEFORE the body: a HEAD request answers with the
 * content type and, on Drive files, the size. The extraction action runs in
 * the default Convex runtime (64 MiB of memory), and reading a 79 MB video
 * linked in a founder update into an ArrayBuffer killed it mid-way — a kill
 * is not an exception, nothing catches it, and the inbound email stayed on
 * 'processing' forever (cf. KNOWN_ISSUES.md « Un lien Drive vers une vidéo
 * tue l'extraction »). Only PDFs and spreadsheets are worth reading: any
 * other type is recorded without a download, and a file over the cap is
 * refused from its announced size. Never throws: a failed Drive source is a
 * NOMINAL outcome for the router.
 */

const FETCH_TIMEOUT_MS = 60_000

export type GDriveKind = 'pdf' | 'excel' | 'other'

export type GDriveFile =
  | { kind: 'pdf' | 'excel'; buf: ArrayBuffer }
  | { kind: 'other' }
  | { kind: 'failed'; detail: 'gdrive_unreachable' | 'file_too_large' }

function targetOf(url: string, fileId: string): { target: string; kind: GDriveKind } {
  if (url.includes('/spreadsheets/')) {
    return {
      target: `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`,
      kind: 'excel',
    }
  }
  if (url.includes('/document/')) {
    return {
      target: `https://docs.google.com/document/d/${fileId}/export?format=pdf`,
      kind: 'pdf',
    }
  }
  if (url.includes('/presentation/')) {
    return {
      target: `https://docs.google.com/presentation/d/${fileId}/export?format=pdf`,
      kind: 'pdf',
    }
  }
  return { target: `https://drive.google.com/uc?export=download&id=${fileId}`, kind: 'other' }
}

function kindOfContentType(contentType: string): GDriveKind {
  if (contentType.includes('pdf')) return 'pdf'
  if (contentType.includes('spreadsheet') || contentType.includes('ms-excel')) return 'excel'
  return 'other'
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, redirect: 'follow', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function downloadGDrive(
  url: string,
  fileId: string,
  maxBytes: number,
): Promise<GDriveFile> {
  const { target, kind: urlKind } = targetOf(url, fileId)
  try {
    const head = await fetchWithTimeout(target, { method: 'HEAD' })
    if (!head.ok) return { kind: 'failed', detail: 'gdrive_unreachable' }
    const contentType = head.headers.get('content-type') ?? ''
    // A private file redirects to an HTML sign-in page — not a download.
    if (contentType.includes('text/html')) return { kind: 'failed', detail: 'gdrive_unreachable' }
    const kind = urlKind === 'other' ? kindOfContentType(contentType) : urlKind
    if (kind === 'other') return { kind: 'other' }
    // Drive announces the size of a stored file; a Docs/Sheets export
    // (generated on the fly) announces 0, which the check after the read
    // still covers.
    const announced = Number(head.headers.get('content-length') ?? 0)
    if (announced > maxBytes) return { kind: 'failed', detail: 'file_too_large' }

    const res = await fetchWithTimeout(target, {})
    if (!res.ok) return { kind: 'failed', detail: 'gdrive_unreachable' }
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) return { kind: 'failed', detail: 'file_too_large' }
    return { kind, buf }
  } catch {
    return { kind: 'failed', detail: 'gdrive_unreachable' }
  }
}
