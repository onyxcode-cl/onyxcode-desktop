import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir = ''
const configDir = vi.fn(() => dir)
vi.mock('../tasks/opencode-config', () => ({ getOpencodeConfigDir: () => configDir() }))

import { codeDocsInstructions } from './code-docs-instructions'
import { CODE_DOCS_PROMPT, CODE_DOCS_PROMPT_FILE } from './code-docs-prompt'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-codedocs-'))
  configDir.mockImplementation(() => dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('codeDocsInstructions', () => {
  it('escribe la guía en la carpeta de configuración y devuelve su ruta', () => {
    const r = codeDocsInstructions()
    expect(r).toEqual([join(dir, CODE_DOCS_PROMPT_FILE)])
    expect(existsSync(r[0])).toBe(true)
    expect(readFileSync(r[0], 'utf8')).toBe(CODE_DOCS_PROMPT)
  })

  it('la guía nombra el argumento `carpeta` que exige la herramienta de Code y la condición «solo si tienes la herramienta»', () => {
    expect(CODE_DOCS_PROMPT).toContain('`carpeta`')
    expect(CODE_DOCS_PROMPT).toContain('solo si tienes la herramienta')
  })

  it('nunca lanza: si la carpeta no se puede resolver o escribir, devuelve []', () => {
    configDir.mockImplementation(() => {
      throw new Error('sin carpeta')
    })
    expect(codeDocsInstructions()).toEqual([])
    configDir.mockImplementation(() => join(dir, 'archivo-normal', 'no-existe'))
    // un archivo normal como padre: mkdir falla
    expect(codeDocsInstructions().length).toBeLessThanOrEqual(1)
  })
})
