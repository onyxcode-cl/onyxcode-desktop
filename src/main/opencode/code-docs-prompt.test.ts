import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { CODE_DOCS_PROMPT, CODE_DOCS_PROMPT_FILE, writeCodeDocsPrompt } from './code-docs-prompt'

const dirs: string[] = []
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'code-docs-prompt-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('guía de documentos para Code', () => {
  it('nombra la herramienta, las cuatro skills y la condición de uso', () => {
    expect(CODE_DOCS_PROMPT).toContain('documentos_crear')
    expect(CODE_DOCS_PROMPT).toContain('documentos_renderizar')
    expect(CODE_DOCS_PROMPT).toContain('carpeta')
    for (const skill of ['docx', 'xlsx', 'pptx', 'pdf']) {
      expect(CODE_DOCS_PROMPT).toContain(`\`${skill}\``)
    }
    expect(CODE_DOCS_PROMPT).toContain('solo si tienes')
  })

  it('no supera 1.200 caracteres', () => {
    expect(CODE_DOCS_PROMPT.length).toBeLessThanOrEqual(1200)
  })

  it('el nombre de archivo es code-documentos.md', () => {
    expect(CODE_DOCS_PROMPT_FILE).toBe('code-documentos.md')
  })

  it('writeCodeDocsPrompt escribe el archivo y devuelve su ruta absoluta', () => {
    const dir = join(tmpDir(), 'config', 'nested')
    const p = writeCodeDocsPrompt(dir)
    expect(p).toBe(join(dir, 'code-documentos.md'))
    expect(readFileSync(p as string, 'utf8')).toBe(CODE_DOCS_PROMPT)
    if (process.platform !== 'win32') {
      expect(statSync(p as string).mode & 0o777).toBe(0o600)
    }
  })

  it('con una ruta no escribible devuelve null sin lanzar', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Un fichero como carpeta padre hace fallar mkdir de forma portable (también como root).
    const base = tmpDir()
    const blocker = join(base, 'fichero')
    writeFileSync(blocker, 'x')
    expect(() => writeCodeDocsPrompt(join(blocker, 'sub'))).not.toThrow()
    expect(writeCodeDocsPrompt(join(blocker, 'sub'))).toBeNull()
    expect(spy).toHaveBeenCalled()
  })
})
