/**
 * Pure tests for the external-connector registry (convex/lib/connectors.ts):
 * registry integrity + generic row validation (`parseConnection`).
 *
 * Run with Node's native test runner via tsx (no dependency):
 *   pnpm test:unit
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONNECTORS,
  getConnector,
  parseConnection,
} from '../convex/lib/connectors'

describe('connector registry integrity', () => {
  it('declares unique platform keys', () => {
    const platforms = CONNECTORS.map((c) => c.platform)
    assert.equal(new Set(platforms).size, platforms.length)
  })

  it('every credentials connector declares its required keys', () => {
    for (const def of CONNECTORS.filter((c) => c.auth === 'credentials')) {
      assert.ok(
        (def.configKeys?.length ?? 0) + (def.credentialKeys?.length ?? 0) > 0,
        `${def.platform} declares no config/credential keys`,
      )
    }
  })

  it('every env connector declares its enabling env vars', () => {
    for (const def of CONNECTORS.filter((c) => c.auth === 'env')) {
      assert.ok(
        (def.envKeys?.length ?? 0) > 0,
        `${def.platform} declares no envKeys`,
      )
    }
  })

  it('getConnector throws on an undeclared platform', () => {
    assert.throws(() => getConnector('nope'))
  })
})

describe('parseConnection', () => {
  const vasco = getConnector('vasco')

  it('accepts a row carrying every declared key', () => {
    const parsed = parseConnection(vasco, {
      config: { clientSlug: 'parallel' },
      credentials: { username: 'u@example.com', password: 'pw' },
    })
    assert.equal(parsed.config.clientSlug, 'parallel')
    assert.equal(parsed.credentials.username, 'u@example.com')
  })

  it('throws a machine code naming the missing credential key', () => {
    assert.throws(
      () =>
        parseConnection(vasco, {
          config: { clientSlug: 'parallel' },
          credentials: { username: 'u@example.com' },
        }),
      /connection_credential_missing:vasco:password/,
    )
  })

  it('throws on a missing config key', () => {
    assert.throws(
      () =>
        parseConnection(vasco, {
          credentials: { username: 'u', password: 'p' },
        }),
      /connection_config_missing:vasco:clientSlug/,
    )
  })

  it('refuses a non-credentials connector', () => {
    assert.throws(
      () => parseConnection(getConnector('powens'), {}),
      /connector_not_credentials:powens/,
    )
  })
})
