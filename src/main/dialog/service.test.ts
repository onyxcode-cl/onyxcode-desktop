// openInEditor: contención a proyectos autorizados y política de «abrir» (F8-B68).
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({ launched: [] as string[][], openPath: vi.fn(async () => ''), codeOk: false }))
vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {}, shell: { openPath: st.openPath, showItemInFolder: vi.fn() } }))
vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    st.launched.push([cmd, ...args])
    const ee: Record<string, (() => void)[]> = {}
    const child = {
      once: (e: string, f: () => void) => {
        ;(ee[e] ??= []).push(f)
        if (e === (st.codeOk && cmd === 'code' ? 'spawn' : 'error')) queueMicrotask(f)
      },
      unref: () => undefined
    }
    return child
  }
}))
vi.mock('./code-candidates', () => ({ codeCandidates: () => ['code'] }))

import { openInEditor } from './service'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-oie-')))
const proj = join(root, 'proyecto')
mkdirSync(join(proj, 'Fake.app'), { recursive: true })
writeFileSync(join(proj, 'a.txt'), 'x')
writeFileSync(join(proj, 'run.sh'), '#!/bin/sh\n')
chmodSync(join(proj, 'run.sh'), 0o755)
mkdirSync(join(root, 'fuera'))
writeFileSync(join(root, 'fuera', 'b.txt'), 'y')
const isRoot = (d: string): boolean => d === proj

describe('dialog:openInEditor', () => {
  beforeEach(() => {
    st.launched.length = 0
    st.openPath.mockClear()
    st.codeOk = false
  })
  it('rechaza una ruta fuera de los proyectos autorizados (sin lanzar nada)', async () => {
    await expect(openInEditor(join(root, 'fuera', 'b.txt'), isRoot)).rejects.toThrow(/no pertenece/)
    await expect(openInEditor('/Applications/Calculator.app', isRoot)).rejects.toThrow()
    expect(st.launched).toEqual([])
    expect(st.openPath).not.toHaveBeenCalled()
  })
  it('un .app o un script ejecutable dentro del proyecto NO se abre con la app por defecto', async () => {
    await expect(openInEditor(join(proj, 'Fake.app'), isRoot)).rejects.toThrow()
    await expect(openInEditor(join(proj, 'run.sh'), isRoot)).rejects.toThrow()
    expect(st.openPath).not.toHaveBeenCalled()
    expect(st.launched.every((l) => l[0] === 'code')).toBe(true)
  })
  it('un archivo normal del proyecto se abre (editor o respaldo)', async () => {
    st.codeOk = true
    expect(await openInEditor(join(proj, 'a.txt'), isRoot)).toEqual({ via: 'code' })
  })
  it('un enlace simbólico dentro del proyecto que apunta fuera se rechaza (realpath)', async () => {
    const { symlinkSync } = await import('node:fs')
    symlinkSync(join(root, 'fuera', 'b.txt'), join(proj, 'enlace.txt'))
    await expect(openInEditor(join(proj, 'enlace.txt'), isRoot)).rejects.toThrow(/no pertenece/)
  })
})
