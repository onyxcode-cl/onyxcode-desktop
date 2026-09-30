import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appAuthFile, opencodeDataHome, prepareOpencodeData, shouldReopenOnboarding } from './data-dir'

let ud = ''
beforeEach(() => {
  ud = mkdtempSync(join(tmpdir(), 'onyx-data-'))
})
afterEach(() => rmSync(ud, { recursive: true, force: true }))

describe('rutas del almacén propio', () => {
  it('opencodeDataHome y appAuthFile cuelgan de userData', () => {
    expect(opencodeDataHome('/u/d')).toBe('/u/d/opencode-data')
    expect(appAuthFile('/u/d')).toBe('/u/d/opencode-data/opencode/auth.json')
  })
})

describe('prepareOpencodeData', () => {
  it('crea el directorio con 0700; created true y luego false', () => {
    expect(prepareOpencodeData(ud)).toEqual({ created: true })
    const dir = join(ud, 'opencode-data', 'opencode')
    expect(statSync(dir).isDirectory()).toBe(true)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(prepareOpencodeData(ud)).toEqual({ created: false })
  })
})

describe('shouldReopenOnboarding', () => {
  it('solo true si created && chatWorkspaceExists && onboarded', () => {
    for (const created of [true, false])
      for (const chatWorkspaceExists of [true, false])
        for (const onboarded of [true, false])
          expect(shouldReopenOnboarding({ created, chatWorkspaceExists, onboarded })).toBe(created && chatWorkspaceExists && onboarded)
  })
})
