import { EventEmitter } from 'node:events'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
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

import { cleanStagingLeftovers, handleWillDownload, initDownloads, moveDownloadToPath, moveOps, sanitizeFileName } from './downloads'

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
  lateDone = false
  cancel(): void {
    this.cancelled = true
    if (!this.lateDone) this.emit('done', {}, 'cancelled')
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

  it('tras cancelar, la carpeta de paso se borra en `done` y no antes', async () => {
    state.decision = 'deny'
    const item = new FakeItem('a.bin')
    item.lateDone = true
    start(item)
    await settle()
    expect(item.cancelled).toBe(true)
    expect(staging().length).toBe(1)
    item.emit('done', {}, 'cancelled')
    await settle(20)
    expect(staging()).toEqual([])
  })

  it('done completed ANTES de la decisión + aceptar: el archivo llega a su destino', async () => {
    let open!: () => void
    state.approvalGate = new Promise<void>((r) => (open = r))
    const item = new FakeItem('a.bin')
    start(item)
    writeFileSync(item.savePath, 'CONTENIDO')
    item.emit('done', {}, 'completed')
    await settle(20)
    expect(existsSync(join(taskDir(), 'a.bin'))).toBe(false)
    open()
    await settle()
    expect(readFileSync(join(taskDir(), 'a.bin'), 'utf8')).toBe('CONTENIDO')
    expect(staging()).toEqual([])
  })

  it('done completed ANTES de la decisión + rechazar: nada en destino y carpeta de paso borrada', async () => {
    let open!: () => void
    state.approvalGate = new Promise<void>((r) => (open = r))
    state.decision = 'deny'
    const item = new FakeItem('a.bin')
    start(item)
    writeFileSync(item.savePath, 'CONTENIDO')
    item.emit('done', {}, 'completed')
    open()
    await settle()
    expect(readdirSync(taskDir())).toEqual([])
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
    const found = existsSync(dest)
      ? dest
      : readdirSync(dirname(dest))
          .map((f) => join(dirname(dest), f))
          .find((f) => f.includes(name.replace('.bin', '')))
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
    cleanStagingLeftovers(true)
    expect(readdirSync(base)).toEqual([])
  })
  it('solo una vez por proceso: otro initDownloads no vuelve a limpiar', () => {
    const base = join(state.userData, 'descargas-pendientes')
    mkdirSync(join(base, 'd-nuevo'), { recursive: true })
    initDownloads({ attributionFor: () => ({ agent: true, sessionId: null }) })
    expect(readdirSync(base)).toEqual(['d-nuevo'])
  })
})

describe('destino elegido por la persona dentro de la tarea', () => {
  beforeEach(() => initDownloads({ attributionFor: () => ({ agent: false, sessionId: null }) }))

  it('subcarpeta de la tarea: queda ahí (reemplazando el nombre elegido)', async () => {
    const sub = join(folder, 'docs')
    mkdirSync(sub)
    writeFileSync(join(sub, 'x.bin'), 'VIEJO')
    state.dialogResult = { canceled: false, filePath: join(sub, 'x.bin') }
    start(new FakeItem('a.bin'))
    await settle()
    expect(readFileSync(join(sub, 'x.bin'), 'utf8')).toBe('CONTENIDO')
    expect(staging()).toEqual([])
  })

  it.skipIf(!posixOnly)('con enlace con ese nombre: no se sigue ni se escribe fuera', async () => {
    const sub = join(folder, 'docs')
    mkdirSync(sub)
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    symlinkSync(join(outside, 'y.bin'), join(sub, 'x.bin'))
    state.dialogResult = { canceled: false, filePath: join(sub, 'x.bin') }
    start(new FakeItem('a.bin'))
    await settle()
    expect(readdirSync(outside)).toEqual([])
    expect(staging()).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')('ruta con otra forma (/var en vez de /private/var): sigue siendo «dentro»', async () => {
    const sub = join(folder, 'docs')
    mkdirSync(sub)
    const alt = sub.replace(/^\/private/, '')
    expect(alt).not.toBe(sub)
    state.dialogResult = { canceled: false, filePath: join(alt, 'x.bin') }
    start(new FakeItem('a.bin'))
    await settle()
    expect(readFileSync(join(sub, 'x.bin'), 'utf8')).toBe('CONTENIDO')
  })

  it('un destino fuera de la tarea no pasa por la ruta de la tarea', async () => {
    const out = join(root, 'otra')
    mkdirSync(out)
    state.dialogResult = { canceled: false, filePath: join(out, 'x.bin') }
    start(new FakeItem('a.bin'))
    await settle()
    expect(readFileSync(join(out, 'x.bin'), 'utf8')).toBe('CONTENIDO')
  })
})

describe('moveDownloadToPath', () => {
  afterEach(() => {
    moveOps.link = (a, b) => linkSync(a, b)
  })
  it('agente: si aparece un archivo con ese nombre entre medias, no lo pisa', async () => {
    const dest = join(root, 'd.bin')
    const staged = join(root, 'staged.bin')
    writeFileSync(staged, 'NUEVO')
    moveOps.link = (a, b) => {
      writeFileSync(dest, 'AJENO') // aparece justo antes del enlace
      linkSync(a, b)
    }
    const out = await moveDownloadToPath(staged, dest, true)
    expect(readFileSync(dest, 'utf8')).toBe('AJENO')
    expect(out).toBe(join(root, 'd (2).bin'))
    expect(readFileSync(out, 'utf8')).toBe('NUEVO')
    expect(existsSync(staged)).toBe(false)
  })
  it('agente, otro disco (EXDEV simulado): copia por temporal, no pisa y no deja temporales', async () => {
    const dest = join(root, 'e.bin')
    const staged = join(root, 'staged.bin')
    writeFileSync(staged, 'NUEVO')
    writeFileSync(dest, 'AJENO')
    moveOps.link = () => {
      throw Object.assign(new Error('x'), { code: 'EXDEV' })
    }
    const out = await moveDownloadToPath(staged, dest, true)
    expect(readFileSync(dest, 'utf8')).toBe('AJENO')
    expect(readFileSync(out, 'utf8')).toBe('NUEVO')
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
  it('persona: reemplaza el destino elegido', async () => {
    const dest = join(root, 'f.bin')
    const staged = join(root, 'staged.bin')
    writeFileSync(staged, 'NUEVO')
    writeFileSync(dest, 'VIEJO')
    expect(await moveDownloadToPath(staged, dest, false)).toBe(dest)
    expect(readFileSync(dest, 'utf8')).toBe('NUEVO')
  })
})

describe('sanitizeFileName', () => {
  it.each([
    ['.', 'descarga'],
    ['..', 'descarga'],
    ['', 'descarga'],
    ['a/b\\c.txt', 'a_b_c.txt'],
    ['a<b>c:d"e|f?g*.txt', 'a_b_c_d_e_f_g_.txt'],
    ['x\u0001y.txt', 'x_y.txt'],
    ['informe.pdf. . ', 'informe.pdf'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['COM1.tar.gz', '_COM1.tar.gz'],
    ['console.txt', 'console.txt']
  ])('%j → %j', (input, expected) => expect(sanitizeFileName(input)).toBe(expected))
  it('limita a ~200 bytes y conserva la extensión', () => {
    const out = sanitizeFileName('á'.repeat(300) + '.pdf')
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(200)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})
