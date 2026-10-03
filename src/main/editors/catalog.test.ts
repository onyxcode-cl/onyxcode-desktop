import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EDITOR_IDS } from '@shared/ipc-code'
import { detectEditors, launchSpec, resolveE2eEditors, type EditorEnv } from './catalog'
import { EditorError, listInstalled, openWithEditor, type EditorsDeps } from './service'

const mac = (present: string[]): EditorEnv => ({
  platform: 'darwin',
  env: {},
  home: '/Users/u',
  exists: (p) => present.includes(p)
})
const win = (present: string[], dirs: Record<string, string[]> = {}): EditorEnv => ({
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
  home: 'C:\\Users\\u',
  exists: (p) => present.includes(p),
  readdir: (p) => dirs[p] ?? []
})

describe('detección por plataforma (simulada)', () => {
  it('macOS: /Applications y ~/Applications; el editor del sistema siempre está al final', () => {
    const e = mac(['/Applications/Visual Studio Code.app', '/Users/u/Applications/Zed.app', '/Applications/WebStorm.app'])
    expect(detectEditors(e).map((x) => x.id)).toEqual(['vscode', 'zed', 'webstorm', 'system'])
  })
  it('sin nada instalado solo queda el del sistema', () => {
    expect(detectEditors(mac([])).map((x) => x.id)).toEqual(['system'])
  })
  it('macOS: se lanza con `open -a <app> <carpeta>` (arreglo de argumentos)', () => {
    const e = mac(['/Applications/Cursor.app'])
    expect(launchSpec('cursor', '/Users/u/proj con espacios', e)).toEqual({
      cmd: 'open',
      args: ['-a', '/Applications/Cursor.app', '/Users/u/proj con espacios']
    })
    expect(launchSpec('zed', '/Users/u/p', e)).toBeNull() // no instalado
  })
  it('Windows: rutas típicas, JetBrains por carpeta de versión', () => {
    const wsExe = 'C:\\Program Files\\JetBrains\\WebStorm 2025.1\\bin\\webstorm64.exe'
    const e = win(
      ['C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', 'C:\\Program Files\\Sublime Text\\sublime_text.exe', wsExe],
      { 'C:\\Program Files\\JetBrains': ['WebStorm 2024.3', 'WebStorm 2025.1', 'PyCharm 2025.1'] }
    )
    expect(detectEditors(e).map((x) => x.id)).toEqual(['vscode', 'sublime', 'webstorm', 'system'])
    expect(launchSpec('webstorm', 'C:\\proj', e)).toEqual({ cmd: wsExe, args: ['C:\\proj'] })
  })
  it('Linux: ejecutables absolutos en carpetas conocidas (no el PATH)', () => {
    const e: EditorEnv = {
      platform: 'linux',
      env: {},
      home: '/home/u',
      exists: (p) => p === '/usr/bin/code' || p === '/home/u/.local/bin/zed'
    }
    expect(detectEditors(e).map((x) => x.id)).toEqual(['vscode', 'zed', 'system'])
    expect(launchSpec('zed', '/home/u/p', e)).toEqual({ cmd: '/home/u/.local/bin/zed', args: ['/home/u/p'] })
  })
  it('rechaza carpetas no absolutas (podrían parecer opciones), ids ajenos y `system`', () => {
    const e = mac(['/Applications/Zed.app'])
    for (const f of ['-n', '--new-window', 'relativa', '', 'a\0b']) expect(launchSpec('zed', f, e), f).toBeNull()
    expect(launchSpec('rm -rf /' as never, '/Users/u/p', e)).toBeNull()
    expect(launchSpec('system', '/Users/u/p', e)).toBeNull()
  })
  it('el catálogo es fijo y los ids no admiten rutas ni comandos', () => {
    expect([...EDITOR_IDS]).toEqual(['vscode', 'cursor', 'zed', 'sublime', 'webstorm', 'intellij', 'system'])
  })
})

describe('openWithEditor', () => {
  const mk = (over: Partial<EditorsDeps> = {}): EditorsDeps & { launched: unknown[]; opened: string[] } => {
    const launched: unknown[] = []
    const opened: string[] = []
    return {
      env: mac(['/Applications/Zed.app']),
      launch: async (s) => (launched.push(s), true),
      openPath: async (f) => (opened.push(f), ''),
      launched,
      opened,
      ...over
    }
  }
  it('lanza el editor elegido', async () => {
    const d = mk()
    await openWithEditor('/Users/u/p', 'zed', d)
    expect(d.launched).toEqual([{ cmd: 'open', args: ['-a', '/Applications/Zed.app', '/Users/u/p'] }])
  })
  it('un id no instalado o desconocido no lanza nada', async () => {
    const d = mk()
    await expect(openWithEditor('/Users/u/p', 'cursor', d)).rejects.toThrow(EditorError)
    await expect(openWithEditor('/Users/u/p', '/bin/sh' as never, d)).rejects.toThrow(EditorError)
    expect(d.launched).toEqual([])
  })
  it('system usa openPath y traduce su fallo', async () => {
    const d = mk()
    await openWithEditor('/Users/u/p', 'system', d)
    expect(d.opened).toEqual(['/Users/u/p'])
    await expect(openWithEditor('/Users/u/p', 'system', mk({ openPath: async () => 'nope' }))).rejects.toThrow(/nope/)
  })
  it('fallo al arrancar se traduce', async () => {
    await expect(openWithEditor('/Users/u/p', 'zed', mk({ launch: async () => false }))).rejects.toThrow(EditorError)
  })
  it('modo E2E: solo registra la llamada, no lanza', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'onyx-ed-')), 'calls.log')
    const e2e = resolveE2eEditors({ isPackaged: false, env: { ONYXCODE_E2E_EDITOR_LOG: log, ONYXCODE_E2E_EDITORS: 'zed,cursor' } })!
    const launch = vi.fn()
    const d = mk({ e2e, launch })
    expect(listInstalled(d).map((x) => x.id)).toEqual(['cursor', 'zed', 'system'])
    await openWithEditor('/Users/u/p', 'zed', d)
    expect(launch).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(log, 'utf8').trim())).toMatchObject({ id: 'zed', folder: '/Users/u/p' })
    await expect(openWithEditor('/Users/u/p', 'sublime', d)).rejects.toThrow(EditorError)
  })
  it('el modo E2E solo se honra sin empaquetar y con ruta absoluta', () => {
    expect(resolveE2eEditors({ isPackaged: true, env: { ONYXCODE_E2E_EDITOR_LOG: '/tmp/x' } })).toBeNull()
    expect(resolveE2eEditors({ isPackaged: false, env: { ONYXCODE_E2E_EDITOR_LOG: 'x' } })).toBeNull()
    expect(resolveE2eEditors({ isPackaged: false, env: {} })).toBeNull()
  })
})
