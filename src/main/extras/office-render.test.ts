import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ExecFileCb = (err: Error | null, stdout?: string) => void
type ExecFileImpl = (
  cmd: string,
  args: string[],
  optsOrCb: unknown,
  cb?: ExecFileCb
) => { on: (event: string, handler: () => void) => void } | void

const state: { execImpl: ExecFileImpl | null; accessOk: Set<string>; mkdtempPath: string | null } = {
  execImpl: null,
  accessOk: new Set(),
  mkdtempPath: null
}

vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], optsOrCb: unknown, cb?: ExecFileCb) => {
    if (!state.execImpl) throw new Error('execImpl no configurado en este test')
    return state.execImpl(cmd, args, optsOrCb, cb)
  }
}))

vi.mock('node:fs/promises', () => ({
  access: async (path: string) => {
    if (!state.accessOk.has(path)) throw new Error(`ENOENT: ${path}`)
  },
  mkdtemp: async () => {
    if (state.mkdtempPath === null) throw new Error('mkdtemp falló en este test')
    return state.mkdtempPath
  }
}))

// Las rutas típicas de soffice y el perfil temporal son de macOS/Linux; el visor de Office con LibreOffice no está en la v1 de Windows.
describe.skipIf(process.platform === 'win32')('findSoffice / convertToPdf', () => {
  beforeEach(() => {
    state.execImpl = null
    state.accessOk = new Set()
    state.mkdtempPath = '/tmp/lazunox-lo-test'
    vi.resetModules()
  })
  afterEach(() => vi.restoreAllMocks())

  it('encuentra soffice en una ruta típica (sin llegar a `which`)', async () => {
    const { findSoffice } = await import('./office-render')
    state.accessOk.add('/opt/homebrew/bin/soffice')
    expect(await findSoffice()).toBe('/opt/homebrew/bin/soffice')
  })

  it('sin ninguna ruta típica, cae a `which soffice` del PATH (llamada de 3 argumentos: sin opciones)', async () => {
    const { findSoffice } = await import('./office-render')
    state.execImpl = (_cmd, _args, optsOrCb) => (optsOrCb as ExecFileCb)(null, '/usr/local/bin/soffice\n')
    expect(await findSoffice()).toBe('/usr/local/bin/soffice')
  })

  it('ni rutas típicas ni `which`: null, no lanza — LibreOffice no está instalado', async () => {
    const { findSoffice } = await import('./office-render')
    state.execImpl = (_cmd, _args, optsOrCb) => (optsOrCb as ExecFileCb)(new Error('no encontrado'), '')
    expect(await findSoffice()).toBeNull()
  })

  it('cachea el resultado — una vez encontrado, no lo vuelve a buscar', async () => {
    const { findSoffice } = await import('./office-render')
    state.accessOk.add('/opt/homebrew/bin/soffice')
    expect(await findSoffice()).toBe('/opt/homebrew/bin/soffice')
    state.accessOk.clear() // si volviera a buscar, ahora no encontraría nada
    expect(await findSoffice()).toBe('/opt/homebrew/bin/soffice')
  })

  it('convertToPdf: sin soffice instalado, null de entrada (nunca llega a intentar convertir)', async () => {
    const { convertToPdf } = await import('./office-render')
    state.execImpl = (_cmd, _args, optsOrCb) => (optsOrCb as ExecFileCb)(new Error('no encontrado'), '')
    expect(await convertToPdf('/tmp/x/deck.pptx', '/tmp/x')).toBeNull()
  })

  it('convertToPdf: con soffice, devuelve la ruta del PDF (mismo nombre, outDir)', async () => {
    const { convertToPdf } = await import('./office-render')
    state.accessOk.add('/opt/homebrew/bin/soffice')
    state.execImpl = (_cmd, args, _opts, cb) => {
      expect(args).toContain('--convert-to')
      expect(args).toContain('/tmp/x/deck.pptx')
      cb!(null)
      return { on: () => undefined }
    }
    expect(await convertToPdf('/tmp/x/deck.pptx', '/tmp/x')).toBe('/tmp/x/deck.pdf')
  })

  it('convertToPdf: si soffice falla (o se acaba el tiempo), null — nunca lanza, quien llama cae al visor estructural', async () => {
    const { convertToPdf } = await import('./office-render')
    state.accessOk.add('/opt/homebrew/bin/soffice')
    state.execImpl = (_cmd, _args, _opts, cb) => {
      cb!(new Error('timeout'))
      return { on: () => undefined }
    }
    expect(await convertToPdf('/tmp/x/deck.pptx', '/tmp/x')).toBeNull()
  })

  it('convertToPdf: si no se puede crear el perfil temporal, null', async () => {
    const { convertToPdf } = await import('./office-render')
    state.accessOk.add('/opt/homebrew/bin/soffice')
    state.mkdtempPath = null
    expect(await convertToPdf('/tmp/x/deck.pptx', '/tmp/x')).toBeNull()
  })
})
