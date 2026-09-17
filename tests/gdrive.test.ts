import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { downloadGDrive } from '../convex/lib/gdrive'

// The extraction action runs in the default Convex runtime (64 MiB): a file
// must be refused from its headers, never after its body sits in memory.
// Each test records the requests made, so "no download" is asserted, not
// assumed.

const MAX = 20 * 1024 * 1024
const originalFetch = globalThis.fetch

type Canned = { status?: number; type: string; length?: number; body?: ArrayBuffer }

function mockFetch(canned: Canned): Array<string> {
  const methods: Array<string> = []
  globalThis.fetch = (_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    methods.push(method)
    const headers: Record<string, string> = { 'content-type': canned.type }
    if (canned.length !== undefined) headers['content-length'] = String(canned.length)
    return Promise.resolve(
      new Response(method === 'HEAD' ? null : (canned.body ?? new ArrayBuffer(0)), {
        status: canned.status ?? 200,
        headers,
      }),
    )
  }
  return methods
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('downloadGDrive', () => {
  it('records a video without downloading it', async () => {
    const methods = mockFetch({ type: 'video/mp4', length: 79_146_095 })
    const out = await downloadGDrive('https://drive.google.com/file/d/abc/view', 'abc', MAX)
    assert.deepEqual(out, { kind: 'other' })
    assert.deepEqual(methods, ['HEAD'])
  })

  it('refuses a PDF over the cap from its announced size', async () => {
    const methods = mockFetch({ type: 'application/pdf', length: MAX + 1 })
    const out = await downloadGDrive('https://drive.google.com/file/d/abc/view', 'abc', MAX)
    assert.deepEqual(out, { kind: 'failed', detail: 'file_too_large' })
    assert.deepEqual(methods, ['HEAD'])
  })

  it('downloads a PDF under the cap', async () => {
    const body = new ArrayBuffer(3)
    const methods = mockFetch({ type: 'application/pdf', length: body.byteLength, body })
    const out = await downloadGDrive('https://drive.google.com/file/d/abc/view', 'abc', MAX)
    assert.equal(out.kind, 'pdf')
    assert.equal('buf' in out && out.buf.byteLength, 3)
    assert.deepEqual(methods, ['HEAD', 'GET'])
  })

  it('still caps an export that announces no size', async () => {
    // Docs/Sheets exports are generated on the fly: content-length is 0.
    const body = new ArrayBuffer(MAX + 1)
    mockFetch({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      length: 0,
      body,
    })
    const out = await downloadGDrive(
      'https://docs.google.com/spreadsheets/d/abc/edit',
      'abc',
      MAX,
    )
    assert.deepEqual(out, { kind: 'failed', detail: 'file_too_large' })
  })

  it('treats a sign-in page as an unreachable file', async () => {
    const methods = mockFetch({ type: 'text/html; charset=utf-8' })
    const out = await downloadGDrive('https://drive.google.com/file/d/abc/view', 'abc', MAX)
    assert.deepEqual(out, { kind: 'failed', detail: 'gdrive_unreachable' })
    assert.deepEqual(methods, ['HEAD'])
  })
})
