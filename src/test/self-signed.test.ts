/**
 * ONYXCODE_SELF_SIGNED: la configuración por defecto no cambia y el hook conserva HELPER_ID/DISCLAIM_ID.
 * El re-firmado se prueba con una «.app» de juguete y firma ad-hoc (identidad «-»): no hace falta ningún certificado.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { APP_ID, DISCLAIM_ID, HELPER_ID } from '../shared/brand'

// @ts-expect-error: CommonJS sin tipos (no forma parte de los tsconfig)
import * as hook from '../../build/after-sign-self-signed.js'

const ROOT = resolve(__dirname, '../..')
const isMac = process.platform === 'darwin'
const tmp = mkdtempSync(join(tmpdir(), 'onyx-selfsigned-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function config(env: Record<string, string>): { afterSign: string; mac: Record<string, unknown>; err: string } {
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      "try{const c=require('./electron-builder.js');console.log(JSON.stringify({afterSign:c.afterSign,mac:c.mac}))}catch(e){console.log(JSON.stringify({err:e.message}))}"
    ],
    { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } }
  )
  return { afterSign: '', mac: {}, err: '', ...(JSON.parse(r.stdout) as object) }
}

describe('electron-builder.js y ONYXCODE_SELF_SIGNED', () => {
  it('por defecto: ad-hoc, sin hardened runtime y con notarize.js (sin cambios)', () => {
    const c = config({})
    expect(c.afterSign).toBe('build/notarize.js')
    expect(c.mac).toMatchObject({ identity: '-', hardenedRuntime: false })
    expect(c.mac.binaries).toBeUndefined()
  })
  it('Developer ID (CSC_NAME sin autofirmado): hardened runtime, entitlements y notarize.js (sin cambios)', () => {
    const c = config({ CSC_NAME: 'Developer ID Application: X (ABC)' })
    expect(c.afterSign).toBe('build/notarize.js')
    expect(c.mac).toMatchObject({ hardenedRuntime: true, entitlements: 'build/entitlements.mac.plist' })
    expect(c.mac.identity).toBeUndefined()
    expect((c.mac.binaries as string[]).length).toBe(3)
  })
  it('autofirmado: firma con CSC_NAME, sin hardened runtime y sin notarizar', () => {
    const c = config({
      ONYXCODE_SELF_SIGNED: '1',
      CSC_NAME: 'OnyxCode Local',
      APPLE_ID: 'a@b.c',
      APPLE_APP_SPECIFIC_PASSWORD: 'x',
      APPLE_TEAM_ID: 'T'
    })
    expect(c.afterSign).toBe('build/after-sign-self-signed.js')
    expect(c.mac).toMatchObject({ identity: 'OnyxCode Local', hardenedRuntime: false })
    expect(c.mac.entitlements).toBeUndefined()
  })
  it('autofirmado sin CSC_NAME: falla con un mensaje claro', () => {
    expect(config({ ONYXCODE_SELF_SIGNED: '1' }).err).toMatch(/requiere CSC_NAME/)
  })
  it('otro valor de la variable no activa nada', () => {
    expect(config({ ONYXCODE_SELF_SIGNED: 'true' }).afterSign).toBe('build/notarize.js')
  })
})

describe('after-sign-self-signed.js', () => {
  it('deriva los identificadores de brand.ts (sin literales duplicados)', () => {
    expect(hook.idsFromBrandSource(readFileSync(join(ROOT, 'src/shared/brand.ts'), 'utf8'))).toEqual({
      appId: APP_ID,
      helperId: HELPER_ID,
      disclaimId: DISCLAIM_ID
    })
  })

  it.runIf(isMac)('vuelve a firmar helpers con su identificador y resella el .app (identidad ad-hoc de prueba)', () => {
    const app = join(tmp, 'OnyxCode.app')
    for (const d of ['Contents/MacOS', 'Contents/Resources/computer-use/bin', 'Contents/Resources/launcher'])
      mkdirSync(join(app, d), { recursive: true })
    writeFileSync(join(app, 'Contents/MacOS/toy'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(app, 'Contents/MacOS/toy'), 0o755)
    writeFileSync(
      join(app, 'Contents/Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>toy</string><key>CFBundleIdentifier</key><string>${APP_ID}</string></dict></plist>`
    )
    const helper = join(app, 'Contents/Resources/computer-use/bin/cu-helper')
    const disclaim = join(app, 'Contents/Resources/launcher/onyxcode-disclaim')
    copyFileSync('/bin/echo', helper)
    copyFileSync('/bin/echo', disclaim)
    const sign = (p: string, extra: string[] = []): void => void spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', ...extra, p])
    // Lo que deja electron-builder: identificadores derivados del nombre del archivo.
    sign(helper)
    sign(disclaim)
    sign(app)
    const ident = (p: string): string | undefined =>
      /^Identifier=(.*)$/m.exec(spawnSync('/usr/bin/codesign', ['-dv', p], { encoding: 'utf8' }).stderr)?.[1]
    expect(ident(helper)).not.toBe(HELPER_ID)
    expect(ident(disclaim)).not.toBe(DISCLAIM_ID)

    hook.resign({ appPath: app, identity: '-', ids: { appId: APP_ID, helperId: HELPER_ID, disclaimId: DISCLAIM_ID } })

    expect(ident(helper)).toBe(HELPER_ID)
    expect(ident(disclaim)).toBe(DISCLAIM_ID)
    expect(ident(app)).toBe(APP_ID)
    expect(spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]).status).toBe(0)
  })
})
