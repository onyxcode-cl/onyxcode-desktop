import { createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_ID, AUTHOR_ALIAS, DISCLAIM_ID, HELPER_ID, UPDATE_KEY_ID, UPDATE_PUBLIC_KEY } from '../shared/brand'

/**
 * Guardia: los literales de identidad que no pueden importar `brand.ts` (electron-builder.js,
 * package.json, los build.sh, el bundle aparte computer-mcp) coinciden con sus constantes.
 */
const ROOT = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')

describe('identidad centralizada en brand.ts', () => {
  it('los IDs derivan de AUTHOR_ALIAS', () => {
    expect(APP_ID).toBe(`cl.${AUTHOR_ALIAS}.onyxcode`)
    expect(DISCLAIM_ID).toBe(`${APP_ID}.disclaim`)
    expect(HELPER_ID).toContain(`.${AUTHOR_ALIAS}.`)
  })

  it('electron-builder.js: appId', () => {
    expect(read('electron-builder.js')).toContain(`appId: '${APP_ID}'`)
  })

  it('package.json: author', () => {
    expect((JSON.parse(read('package.json')) as { author: string }).author).toBe(AUTHOR_ALIAS)
  })

  it('computer-use/build.sh: identificador del helper', () => {
    expect(read('resources/computer-use/build.sh')).toMatch(new RegExp(`^HELPER_ID="${HELPER_ID.replace(/\./g, '\\.')}"$`, 'm'))
  })

  it('launcher/build.sh: identificador de disclaim', () => {
    expect(read('resources/launcher/build.sh')).toMatch(new RegExp(`^DISCLAIM_ID="${DISCLAIM_ID.replace(/\./g, '\\.')}"$`, 'm'))
  })

  it('grants.ts importa APP_ID de brand', () => {
    const src = read('src/main/computer/grants.ts')
    expect(src).toContain("import { APP_ID } from '@shared/brand'")
    expect(src).not.toContain(`'${APP_ID}'`)
  })

  it('mcp-server.ts (bundle aparte, sin imports de la app) lleva el literal APP_ID', () => {
    const src = read('src/main/computer/mcp-server.ts')
    expect(src).toContain(`'${APP_ID}',`)
    expect(src).not.toContain('@shared/')
  })

  it('actualizador: clave pública vacía o Ed25519 válida, e identificador de clave seguro', () => {
    if (UPDATE_PUBLIC_KEY !== '') {
      const raw = Buffer.from(UPDATE_PUBLIC_KEY, 'base64')
      const der = raw.length === 32 ? Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]) : raw
      expect(createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType).toBe('ed25519')
    }
    expect(UPDATE_KEY_ID).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  })

  it('verify-release.mjs lee UPDATE_PUBLIC_KEY, RELEASES_REPO y swap.sh', () => {
    const src = read('scripts/verify-release.mjs')
    expect(src).toContain('UPDATE_PUBLIC_KEY')
    expect(src).toContain('RELEASES_REPO')
    expect(src).toContain('resources/updater/swap.sh')
  })

  it('electron-builder.js lleva swap.sh en extraResources y fuera del asar', () => {
    const src = read('electron-builder.js')
    expect(src).toMatch(/from: 'resources\/updater',\s*to: 'updater',\s*filter: \['swap\.sh'\]/)
    expect(src).toContain("'!resources/updater/**'")
  })
})
