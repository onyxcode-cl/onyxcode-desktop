import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../../test/platform'

const state = vi.hoisted(() => ({
  userData: '',
  decision: 'allow' as 'allow' | 'deny',
  dialogResult: { canceled: false, filePath: '' } as { canceled: boolean; filePath?: string },
  dialogCalls: 0,
  owner: null as unknown,
  approvalGate: null as Promise<void> | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getName: () => 'Lazunox' },
  dialog: {
    showSaveDialog: vi.fn(async () => {
      state.dialogCalls++
      return state.dialogResult
    })
  },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  }
}))
vi.mock('./surface', () => ({ tabByWebContents: () => (state.owner ? { owner: state.owner } : null) }))
vi.mock('./approvals', () => ({
  requestApproval: vi.fn(async () => {
    if (state.approvalGate) await state.approvalGate
    return state.decision
  })
}))
vi.mock('../migrations/migrate-folder-scratch', () => ({ migrateFolderScratch: () => {} }))

import { cleanStagingLeftovers, handleWillDownload, initDownloads } from './downloads'

/** DownloadItem falso: registra si `setSavePath` se llamó ANTES de que `handleWillDownload` devolviera el control. */
class FakeItem extends EventEmitter {
  savePath = ''
  setSavePathCalledSync = false
  inHandler = false
  paused = false
  cancelled = false
  resumed = false
  constructor(private name: string) {
    super()
  }
  getFilename = (): string => this.name
  getURL = (): string => 'https://example.com/x'
  getSavePath = (): string => this.savePath
  setSavePath(p: string): void {
    this.savePath = p
    if (this.inHandler) this.setSavePathCalledSync = true
  }
  pause(): void {
    this.paused = true
  }
  resume(): void {
    this.resumed = true
    // Como Chromium: al reanudar escribe en la ruta fijada y luego termina.
    setTimeout(() => {
      if (this.cancelled || !this.savePath) return
      writeFileSync(this.savePath, 'CONTENIDO')
      this.emit('done', {}, 'completed')
    }, 5)
  }
  cancel(): void {
    this.cancelled = true
    this.emit('done', {}, 'cancelled')
  }
}

function start(item: FakeItem): void {
  item.inHandler = true
  handleWillDownload({ preventDefault: vi.fn() } as never, item as never, {} as never)
  item.inHandler = false
}
const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root: string
let folder: string
const staging = (): string[] => {
  try {
    return readdirSync(join(state.userData, 'descargas-pendientes'))
  } catch {
    return []
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-descargas-')))
  state.userData = join(root, 'ud')
  mkdirSync(state.userData)
  folder = join(root, 'tarea')
  mkdirSync(folder)
  state.owner = { kind: 'tasks', folder }
  state.decision = 'allow'
  state.dialogCalls = 0
  state.approvalGate = null
  initDownloads({ attributionFor: () => ({ agent: true, sessionId: 's1' }) })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const taskDir = (): string => join(folder, '.lazunox', 'trabajo', 'descargas')

describe('descargas: ruta fijada de forma síncrona', () => {
  it('setSavePath se llama dentro de will-download, antes de devolver el control (y antes de pausar/decidir)', async () => {
    const item = new FakeItem('a.bin')
    start(item)
    expect(item.setSavePathCalledSync).toBe(true)
    expect(item.savePath.startsWith(join(state.userData, 'descargas-pendientes'))).toBe(true)
    expect(item.paused).toBe(true)
    await settle()
  })

  it('agente + tarea, aceptar: el archivo queda en la carpeta de la tarea y la carpeta de paso se borra', async () => {
    const item = new FakeItem('a.bin')
    start(item)
    await settle()
    expect(readFileSync(join(taskDir(), 'a.bin'), 'utf8')).toBe('CONTENIDO')
    expect(staging()).toEqual([])
  })

  it('agente, rechazar: se cancela, no queda nada en destino y la carpeta de paso se borra', async () => {
    state.decision = 'deny'
    const item = new FakeItem('a.bin')
    start(item)
    await settle()
    expect(item.cancelled).toBe(true)
    expect(existsSync(join(taskDir(), 'a.bin'))).toBe(false)
    expect(staging()).toEqual([])
  })

  it('done con interrupted: nada en destino y carpeta de paso borrada (también si llega antes de la decisión)', async () => {
    let open!: () => void
    state.approvalGate = new Promise<void>((r) => (open = r))
    const item = new FakeItem('a.bin')
    start(item)
    item.emit('done', {}, 'interrupted')
    await settle()
    expect(staging()).toEqual([])
    open()
    await settle()
    expect(item.resumed).toBe(false)
    expect(readdirSync(taskDir())).toEqual([])
    expect(staging()).toEqual([])
  })

  it('persona + tarea, diálogo cancelado: se cancela y se borra la carpeta de paso', async () => {
    initDownloads({ attributionFor: () => ({ agent: false, sessionId: null }) })
    state.dialogResult = { canceled: true }
    const item = new FakeItem('a.bin')
    start(item)
    await settle()
    expect(state.dialogCalls).toBe(1)
    expect(item.cancelled).toBe(true)
    expect(staging()).toEqual([])
  })

  it('persona: ruta elegida en el diálogo; reemplaza lo que hubiera', async () => {
    initDownloads({ attributionFor: () => ({ agent: false, sessionId: null }) })
    const dest = join(root, 'elegido', 'sub.bin')
    mkdirSync(dirname(dest))
    writeFileSync(dest, 'VIEJO')
    state.dialogResult = { canceled: false, filePath: dest }
    const item = new FakeItem('a.bin')
    start(item)
    await settle()
    expect(readFileSync(dest, 'utf8')).toBe('CONTENIDO')
    expect(staging()).toEqual([])
  })

  it('Code + agente: se mueve a ~/Downloads/<nombre interno>/ sin pisar y la carpeta de paso se borra', async () => {
    state.owner = { kind: 'code' }
    const name = `lzx-test-${Date.now()}.bin`
    const item = new FakeItem(name)
    start(item)
    await settle()
    const dest = join(homedir(), 'Downloads', 'Lazunox', name)
    const found = existsSync(dest) ? dest : readdirSync(dirname(dest)).map((f) => join(dirname(dest), f)).find((f) => f.includes(name.replace('.bin', '')))
    try {
      expect(found).toBeTruthy()
      expect(readFileSync(found as string, 'utf8')).toBe('CONTENIDO')
    } finally {
      if (found) rmSync(found, { force: true })
    }
    expect(staging()).toEqual([])
  })
})

describe.skipIf(!posixOnly)('descargas: enlace en la carpeta de la tarea (como 1.8.18)', () => {
  it('`descargas` es un enlace hacia fuera: la descarga se cancela y no escribe fuera', async () => {
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    mkdirSync(join(folder, '.lazunox', 'trabajo'), { recursive: true })
    symlinkSync(outside, taskDir())
    const item = new FakeItem('a.bin')
    const ev = { preventDefault: vi.fn() }
    handleWillDownload(ev as never, item as never, {} as never)
    expect(ev.preventDefault).toHaveBeenCalled()
    await settle()
    expect(readdirSync(outside)).toEqual([])
    expect(staging()).toEqual([])
  })
})

describe('limpieza de restos al arrancar', () => {
  it('borra las carpetas d-* de sesiones anteriores y no falla si no existe la carpeta', () => {
    expect(() => cleanStagingLeftovers()).not.toThrow()
    const base = join(state.userData, 'descargas-pendientes')
    mkdirSync(join(base, 'd-abc'), { recursive: true })
    writeFileSync(join(base, 'd-abc', 'x.bin'), 'x')
    mkdirSync(join(base, 'd-def'))
    initDownloads({ attributionFor: () => ({ agent: true, sessionId: null }) })
    expect(readdirSync(base)).toEqual([])
  })
})
