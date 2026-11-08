import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/no/se/usa' } }))
// Los Ajustes reales no se tocan: el guardado de la huella se comprueba contra este doble.
const setMock = vi.hoisted(() => vi.fn())
vi.mock('../store', () => ({ settingsStore: { set: setMock } }))

import { hooksDir, hooksFile, readHooks, sha256Hex, writeHooks } from './user-hooks-store'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lazunox-hooks-'))
  dirs.push(d)
  return d
}
beforeEach(() => setMock.mockReset())
afterEach(() => {
  vi.restoreAllMocks()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const OK = JSON.stringify({ hooks: { Stop: [{ command: 'echo listo' }] } })

describe('archivo de ganchos', () => {
  it('vive en userData/hooks/hooks.json', () => {
    const u = tmp()
    expect(hooksDir(u)).toBe(join(u, 'hooks'))
    expect(hooksFile(u)).toBe(join(u, 'hooks', 'hooks.json'))
  })

  it('no se crea al leer: sin archivo devuelve vacío y no toca el disco', () => {
    const u = tmp()
    expect(readHooks(u)).toEqual({ text: '', exists: false })
    expect(existsSync(hooksDir(u))).toBe(false)
  })

  it('guardar crea la carpeta 0700 y el archivo 0600, sin temporales sobrantes', () => {
    const u = tmp()
    expect(writeHooks(OK, u)).toEqual({ ok: true })
    expect(readHooks(u)).toEqual({ text: `${OK}\n`, exists: true })
    if (process.platform !== 'win32') {
      expect(statSync(hooksDir(u)).mode & 0o777).toBe(0o700)
      expect(statSync(hooksFile(u)).mode & 0o777).toBe(0o600)
    }
    expect(readdirSync(hooksDir(u))).toEqual(['hooks.json'])
  })

  it('texto vacío guarda {"hooks":{}}; un segundo guardado reemplaza al primero', () => {
    const u = tmp()
    expect(writeHooks('', u)).toEqual({ ok: true })
    expect(readFileSync(hooksFile(u), 'utf8')).toBe('{"hooks":{}}\n')
    expect(writeHooks(OK, u)).toEqual({ ok: true })
    expect(readFileSync(hooksFile(u), 'utf8')).toBe(`${OK}\n`)
  })

  it('un contenido inválido no escribe nada (ni crea la carpeta) y devuelve códigos', () => {
    const u = tmp()
    const r = writeHooks('{"hooks":{"Nope":[]}}', u)
    expect(r).toEqual({ ok: false, issues: [{ code: 'unknownEvent', params: { event: 'Nope' } }] })
    expect(existsSync(hooksDir(u))).toBe(false)
  })

  it('un archivo válido anterior sobrevive a un guardado rechazado', () => {
    const u = tmp()
    writeHooks(OK, u)
    expect(writeHooks('{', u).ok).toBe(false)
    expect(readFileSync(hooksFile(u), 'utf8')).toBe(`${OK}\n`)
  })

  it('un fallo de disco devuelve writeFailed y no filtra el contenido a los registros', () => {
    const u = tmp()
    // `hooks` es un archivo: no se puede crear la carpeta.
    writeFileSync(join(u, 'hooks'), 'x')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const secreto = JSON.stringify({ hooks: { Stop: [{ command: 'echo secreto-xyz' }] } })
    expect(writeHooks(secreto, u)).toEqual({ ok: false, issues: [{ code: 'writeFailed' }] })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secreto-xyz')
    expect(JSON.stringify(spy.mock.calls)).not.toContain(u)
  })

  it('un enlace simbólico temporal viejo no se sigue', () => {
    if (process.platform === 'win32') return
    const u = tmp()
    const fuera = tmp()
    mkdirSync(hooksDir(u), { recursive: true })
    writeFileSync(join(fuera, 'victima.txt'), 'intacto')
    symlinkSync(join(fuera, 'victima.txt'), `${hooksFile(u)}.${process.pid}.tmp`)
    expect(writeHooks(OK, u)).toEqual({ ok: true })
    expect(readFileSync(join(fuera, 'victima.txt'), 'utf8')).toBe('intacto')
  })

  it('leer un archivo que supera el tope devuelve vacío', () => {
    const u = tmp()
    mkdirSync(hooksDir(u), { recursive: true })
    writeFileSync(hooksFile(u), 'x'.repeat(70 * 1024))
    expect(readHooks(u)).toEqual({ text: '', exists: true })
  })
})

describe('huella de los ganchos (R6)', () => {
  const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

  it('guardar calcula el sha256 de los BYTES escritos y lo guarda en Ajustes (apagando el aviso de revisión)', () => {
    const u = tmp()
    expect(writeHooks(OK, u)).toEqual({ ok: true })
    const enDisco = readFileSync(hooksFile(u))
    expect(setMock).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledWith({ userHooksSha256: sha(enDisco), userHooksReview: false })
    expect(setMock.mock.calls[0][0].userHooksSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('con texto no ASCII (UTF-8 de varios bytes) la huella es la de los bytes, no la de los caracteres', () => {
    const u = tmp()
    const texto = JSON.stringify({ hooks: { Stop: [{ command: 'echo ñandú 日本 😀' }] } })
    expect(writeHooks(texto, u)).toEqual({ ok: true })
    expect(setMock.mock.calls[0][0].userHooksSha256).toBe(sha(readFileSync(hooksFile(u))))
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha('abc'))
  })

  it('editar el archivo a mano deja de coincidir con la huella guardada', () => {
    const u = tmp()
    writeHooks(OK, u)
    const guardada = setMock.mock.calls[0][0].userHooksSha256 as string
    writeFileSync(hooksFile(u), readFileSync(hooksFile(u), 'utf8').replace('listo', 'otra cosa'))
    expect(sha(readFileSync(hooksFile(u)))).not.toBe(guardada)
  })

  it('un contenido rechazado NO toca la huella', () => {
    const u = tmp()
    expect(writeHooks('{', u).ok).toBe(false)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('si guardar la huella falla devuelve writeFailed (los ganchos no corren con la huella vieja: falla cerrado)', () => {
    const u = tmp()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setMock.mockImplementation(() => {
      throw Object.assign(new Error('disco'), { code: 'ENOSPC' })
    })
    expect(writeHooks(OK, u)).toEqual({ ok: false, issues: [{ code: 'writeFailed' }] })
    expect(JSON.stringify(spy.mock.calls)).toContain('ENOSPC')
  })
})
