/**
 * Modo unificado (ola 2): el agente aislado de una carpeta de chat (`~/Lazunox/Chats/<id>`) o de CUALQUIER otra carpeta
 * no puede LEER las carpetas de OTROS chats. El perfil base es `(allow default)`, así que sin la regla nueva sí podía.
 *
 * Dos partes: (1) texto del perfil (orden de las reglas, idéntico sin la bandera) y (2) Seatbelt REAL (`sandbox-exec`)
 * con un «home» inyectado bajo el home real (nunca se toca `~/Lazunox` de verdad). Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile, type SandboxProfileOptions } from './sandbox-profile'
import { macOnly } from '../../test/platform'

const HOME = '/Users/fixture'
const base: SandboxProfileOptions = {
  folder: '/fixture/work/proyecto',
  privateDir: '/fixture/userData/tasks-sandbox/0123456789abcdef',
  userData: '/fixture/userData',
  readOnly: ['/fixture/userData/opencode-config'],
  home: HOME
}

describe.skipIf(!macOnly)('perfil Seatbelt: lectura de ~/Lazunox/Chats (texto)', () => {
  it('sin la bandera el perfil es EXACTAMENTE el de siempre (con y sin carpeta de chat)', () => {
    const before = process.env.LAZUNOX_UNIFIED_APPS
    delete process.env.LAZUNOX_UNIFIED_APPS
    try {
      for (const folder of [base.folder, `${HOME}/Lazunox/Chats/20261027-abc`]) {
        const o = { ...base, folder }
        const plain = buildSandboxProfile(o)
        expect(buildSandboxProfile({ ...o, isolateChats: false })).toBe(plain)
        expect(plain).not.toContain(`(subpath "${HOME}/Lazunox/Chats")`)
        expect(plain).not.toContain('Carpetas de OTROS chats')
      }
    } finally {
      if (before !== undefined) process.env.LAZUNOX_UNIFIED_APPS = before
    }
  })

  it('con la bandera de entorno se activa; con isolateChats:false explícito, no', () => {
    const before = process.env.LAZUNOX_UNIFIED_APPS
    process.env.LAZUNOX_UNIFIED_APPS = '1'
    try {
      expect(buildSandboxProfile(base)).toContain(`(subpath "${HOME}/Lazunox/Chats")`)
      expect(buildSandboxProfile({ ...base, isolateChats: false })).not.toContain('Lazunox/Chats')
    } finally {
      if (before === undefined) delete process.env.LAZUNOX_UNIFIED_APPS
      else process.env.LAZUNOX_UNIFIED_APPS = before
    }
  })

  it('deniega Chats y re-permite SOLO la carpeta propia, DESPUÉS de la denegación (gana la última)', () => {
    const chat = `${HOME}/Lazunox/Chats/20261027-abc`
    const out = buildSandboxProfile({ ...base, folder: chat, isolateChats: true })
    const deny = out.indexOf(`(deny file-read* file-write* (subpath "${HOME}/Lazunox/Chats"))`)
    const allow = out.indexOf(`(allow file-read* file-write* (subpath "${chat}"))`)
    expect(deny).toBeGreaterThan(out.indexOf('(deny file-read* file-write*\n'))
    expect(allow).toBeGreaterThan(deny)
    // El borrado sigue denegado en la propia carpeta (la regla de unlink va después).
    expect(out.indexOf(`(deny file-write-unlink (subpath "${chat}"))`)).toBeGreaterThan(allow)
  })

  it('carpeta fuera de Chats: solo la denegación, ninguna re-permisión sobre Chats', () => {
    const out = buildSandboxProfile({ ...base, isolateChats: true })
    expect(out).toContain(`(deny file-read* file-write* (subpath "${HOME}/Lazunox/Chats"))`)
    expect(out).not.toContain('(allow file-read* file-write* (subpath "/fixture/work/proyecto"))')
    expect(out).not.toMatch(/\(allow file-read\*[^\n]*Lazunox\/Chats/)
  })

  it('carpetas adicionales dentro de Chats: lectura (ro) y lectura+escritura (rw) re-permitidas; las de fuera no', () => {
    const out = buildSandboxProfile({
      ...base,
      isolateChats: true,
      extraFolders: [
        { path: `${HOME}/Lazunox/Chats/rw1`, mode: 'rw' },
        { path: `${HOME}/Lazunox/Chats/ro1`, mode: 'ro' },
        { path: '/fixture/otra', mode: 'rw' }
      ]
    })
    expect(out).toContain(`(allow file-read* file-write* (subpath "${HOME}/Lazunox/Chats/rw1"))`)
    expect(out).toContain(`(allow file-read* (subpath "${HOME}/Lazunox/Chats/ro1"))`)
    expect(out).not.toContain('"/fixture/otra"))\n(allow file-read')
    expect(out).toContain(`(deny file-write* (subpath "${HOME}/Lazunox/Chats/ro1"))`)
  })
})

describe.skipIf(!macOnly)('Seatbelt REAL: un chat no lee las carpetas de otros chats', () => {
  let tmp: string
  let home: string
  let a: string
  let b: string
  let docs: string
  let priv: string

  beforeAll(() => {
    // Bajo el home real (fuera de /tmp y de los temporales con escritura); el «home» del perfil es `tmp/home`.
    tmp = realpathSync(mkdtempSync(join(homedir(), '.lazunox-sandbox-test-')))
    home = join(tmp, 'home')
    a = join(home, 'Lazunox', 'Chats', 'a')
    b = join(home, 'Lazunox', 'Chats', 'b')
    docs = join(home, 'Documents', 'x')
    priv = join(tmp, 'priv')
    for (const d of [a, b, docs, priv]) mkdirSync(d, { recursive: true })
    writeFileSync(join(a, 'f.txt'), 'AAA')
    writeFileSync(join(b, 'f.txt'), 'BBB')
    writeFileSync(join(docs, 'f.txt'), 'DOC')
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  const run = (folder: string, isolateChats: boolean, cmd: string) => {
    const profile = buildSandboxProfile({ folder, privateDir: priv, home, isolateChats })
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', cmd], { cwd: folder, encoding: 'utf8', timeout: 20000 })
    return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
  }

  it('control (perfil de siempre): desde el chat a SÍ se lee el chat b (el hueco)', () => {
    const r = run(a, false, `cat '${b}/f.txt'`)
    expect(r.out).toBe('BBB')
  })

  it('con la regla: desde el chat a, el chat b NO se lee ni se lista', () => {
    const r = run(a, true, `cat '${b}/f.txt'`)
    expect(r.status).not.toBe(0)
    expect(r.out).toMatch(/Operation not permitted/)
    expect(run(a, true, `ls '${b}'`).status).not.toBe(0)
    expect(run(a, true, `ls '${join(home, 'Lazunox', 'Chats')}'`).status).not.toBe(0)
  })

  it('con la regla: la carpeta propia sigue leyéndose y escribiéndose; no se borra sin permiso', () => {
    expect(run(a, true, `cat '${a}/f.txt'`).out).toBe('AAA')
    expect(run(a, true, `cat f.txt; pwd -P; ls`).out).toContain('AAA')
    expect(run(a, true, `echo nuevo > '${a}/n.txt' && cat '${a}/n.txt'`).out).toBe('nuevo')
    expect(readFileSync(join(a, 'n.txt'), 'utf8').trim()).toBe('nuevo')
    expect(run(a, true, `rm '${a}/n.txt'`).status).not.toBe(0)
    expect(existsSync(join(a, 'n.txt'))).toBe(true)
    // Y no escribe en el ajeno.
    expect(run(a, true, `echo x > '${b}/z.txt'`).status).not.toBe(0)
    expect(existsSync(join(b, 'z.txt'))).toBe(false)
  })

  it('con la regla: desde una carpeta fuera de Chats no se lee ~/Lazunox/Chats/*, y lo suyo sigue funcionando', () => {
    const r = run(docs, true, `cat '${a}/f.txt'`)
    expect(r.status).not.toBe(0)
    expect(r.out).toMatch(/Operation not permitted/)
    expect(run(docs, true, `cat '${docs}/f.txt'`).out).toBe('DOC')
    expect(run(docs, true, `echo y > '${docs}/y.txt' && cat '${docs}/y.txt'`).out).toBe('y')
    // Sin la regla (control) sí se leía.
    expect(run(docs, false, `cat '${a}/f.txt'`).out).toBe('AAA')
  })
})
