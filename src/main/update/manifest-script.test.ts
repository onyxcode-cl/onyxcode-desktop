/**
 * `npm run verify:update-manifest` (scripts/verify-update-manifest.mjs): sin red, sin .app, en cualquier sistema. Además comprueba
 * que lo que firma update-lib.mjs lo acepta el CLIENTE real (src/main/update/signature.ts + src/shared/update-install.ts) y que el
 * cliente rechaza lo manipulado igual que el script.
 */
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseManifest, validateManifest } from '@shared/update-install'
import { verifyWithKeys } from './signature'
import * as lib from '../../../scripts/update-lib.mjs'
// @ts-expect-error: script .mjs sin declaración de tipos
import { runManifestChecks } from '../../../scripts/verify-update-manifest.mjs'

describe('verify-update-manifest', () => {
  it('todas las comprobaciones del script se comportan como deben', async () => {
    const results = (await runManifestChecks()) as Array<{ name: string; ok: boolean; detail?: string }>
    expect(results.length).toBeGreaterThanOrEqual(15)
    expect(results.filter((r) => !r.ok)).toEqual([])
  })

  it('el cliente acepta lo que firma update-lib y rechaza un byte cambiado, otra clave o un downgrade', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const pub = lib.spkiBase64(publicKey)
    const manifest = lib.buildManifest({
      appId: 'cl.x.onyxcode',
      version: '0.4.0',
      tag: 'v0.4.0',
      keyId: 'k1',
      zipName: 'OnyxCode-0.4.0-arm64.zip',
      size: 10,
      sha256: 'a'.repeat(64),
      publishedAt: '2026-01-01T00:00:00.000Z'
    })
    const bytes = lib.manifestBytes(manifest)
    const sig = lib.signBytes(bytes, privateKey)
    expect(verifyWithKeys(bytes, sig, [{ id: 'k1', key: pub }])).toBe('k1')
    const parsed = parseManifest(JSON.parse(bytes.toString('utf8')))!
    expect(parsed).not.toBeNull()
    const ctx = { appId: 'cl.x.onyxcode', current: '0.3.0', tag: 'v0.4.0', keyId: 'k1' }
    expect(validateManifest(parsed, ctx).ok).toBe(true)
    expect(validateManifest(parsed, { ...ctx, current: '0.4.0' }).ok).toBe(false)
    const flipped = Buffer.from(bytes)
    flipped[10] ^= 1
    expect(verifyWithKeys(flipped, sig, [{ id: 'k1', key: pub }])).toBeNull()
    const other = lib.spkiBase64(generateKeyPairSync('ed25519').publicKey)
    expect(verifyWithKeys(bytes, sig, [{ id: 'k2', key: other }])).toBeNull()
  })
})
