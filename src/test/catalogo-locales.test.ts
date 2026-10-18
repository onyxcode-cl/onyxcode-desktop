import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import raw from '../../resources/catalogo/catalogo.json'
import { CATALOG, validateCatalog, type CatalogLocalConnector as LocalConn } from '../shared/catalogo'
import { es } from '../shared/i18n/es'
import { en } from '../shared/i18n/en'

/**
 * Conectores LOCALES del catálogo (F8-B186): programas de terceros que la app instala y ejecuta en el equipo. Esta prueba fija lo que
 * hace seguro ofrecerlos: versión exacta, archivos de bloqueo con hash, `--read-only` obligatorio, sin shell ni texto de la persona
 * en comandos, y herramientas que cambian algo siempre bloqueadas. Ver `docs/CATALOGO.md` y `docs/SEGURIDAD.md` §3 (F8-B186).
 */
const ROOT = resolve(__dirname, '../..')
const LOCK_DIR = resolve(ROOT, 'resources/catalogo/conectores-locales')

/* eslint-disable @typescript-eslint/no-explicit-any */
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(raw))
const locals = (): LocalConn[] => CATALOG.connectors.filter((c): c is LocalConn => c.transport === 'local')
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const localOf = (c: Record<string, any>, id = 'google-workspace'): Record<string, any> =>
  c.connectors.find((x: { id: string }) => x.id === id)
const errorsWith = (mut: (c: Record<string, any>) => void): string => {
  const c = clone()
  mut(c)
  return validateCatalog(c).join('\n')
}
const rt = (mut: (r: Record<string, any>) => void, id = 'google-workspace'): string => errorsWith((c) => mut(localOf(c, id).runtime))

describe('catálogo: conectores locales (programas de terceros que se instalan en el equipo)', () => {
  it('hay exactamente los dos esperados: Google Workspace y Microsoft 365', () => {
    expect(locals().map((c) => c.id)).toEqual(['google-workspace', 'microsoft-365'])
    expect(validateCatalog(raw)).toEqual([])
  })

  it('versión EXACTA fijada (nada de rangos ni «latest»)', () => {
    for (const c of locals()) expect(c.runtime.version, c.id).toMatch(/^\d+\.\d+\.\d+$/)
    for (const bad of ['^1.2.3', '~1.2.3', '>=1.0.0', 'latest', '1.2', '1.2.x', '*', ''])
      expect(
        rt((r) => (r.version = bad)),
        bad
      ).toMatch(/version/)
  })

  it('--read-only es OBLIGATORIO: una ficha local sin él no pasa la validación', () => {
    for (const c of locals()) expect(c.runtime.args, c.id).toContain('--read-only')
    for (const id of ['google-workspace', 'microsoft-365'])
      expect(
        rt((r) => (r.args = r.args.filter((a: string) => a !== '--read-only')), id),
        id
      ).toMatch(/--read-only/)
    expect(rt((r) => (r.args = ['--tools', 'gmail', '--read-only=false']))).toMatch(/--read-only/)
    expect(rt((r) => (r.args = ['--tools', 'gmail']))).toMatch(/--read-only/)
  })

  it('el SHA-256 de cada archivo de bloqueo coincide con el archivo empaquetado, y uno alterado se detecta', () => {
    for (const c of locals()) {
      expect(c.runtime.files.length, c.id).toBeGreaterThan(0)
      for (const f of c.runtime.files) expect(sha(resolve(LOCK_DIR, c.runtime.dir, f.name)), `${c.id}/${f.name}`).toBe(f.sha256)
    }
    expect(rt((r) => (r.files[0].sha256 = 'abc'))).toMatch(/sha256/)
    expect(rt((r) => (r.files[0].sha256 = 'A'.repeat(64)))).toMatch(/sha256/)
    expect(rt((r) => delete r.files)).toMatch(/files|bloqueo/)
    expect(rt((r) => (r.files = []))).toMatch(/files|bloqueo/)
    expect(rt((r) => r.files.push({ name: 'extra.txt', sha256: '0'.repeat(64) }))).toMatch(/exactamente/)
  })

  it('requirements.lock: todo paquete lleva hash SHA-256 y viene del índice (nada de URLs, git ni rutas)', () => {
    const text = readFileSync(resolve(LOCK_DIR, 'google-workspace/requirements.lock'), 'utf8')
    const reqs = text.split(/\n(?=[A-Za-z0-9])/).filter((b) => /^[A-Za-z0-9][A-Za-z0-9._-]*==/.test(b))
    expect(reqs.length).toBeGreaterThan(50)
    for (const r of reqs) expect(r.match(/--hash=sha256:[0-9a-f]{64}/g)?.length ?? 0, r.split('\n')[0]).toBeGreaterThan(0)
    expect(text).not.toMatch(/^\s*(-e |--index-url|--extra-index-url|--find-links|git\+|https?:)/m)
    expect(text).not.toMatch(/ @ /)
    const c = locals().find((x) => x.id === 'google-workspace')!
    expect(text).toMatch(new RegExp(`^${c.runtime.package}==${c.runtime.version.replace(/\./g, '\\.')} `, 'm'))
  })

  it('package-lock.json: todo paquete lleva integridad sha512 y viene del registro oficial; el raíz pide la versión exacta', () => {
    const lock = JSON.parse(readFileSync(resolve(LOCK_DIR, 'microsoft-365/package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity?: string; resolved?: string }>
    }
    const entries = Object.entries(lock.packages).filter(([k]) => k !== '')
    expect(entries.length).toBeGreaterThan(50)
    for (const [k, p] of entries) {
      expect(p.integrity, k).toMatch(/^sha512-[A-Za-z0-9+/=]+$/)
      expect(p.resolved, k).toMatch(/^https:\/\/registry\.npmjs\.org\//)
    }
    const c = locals().find((x) => x.id === 'microsoft-365')!
    const pkg = JSON.parse(readFileSync(resolve(LOCK_DIR, 'microsoft-365/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies).toEqual({ [c.runtime.package]: c.runtime.version })
    expect(lock.packages[`node_modules/${c.runtime.package}`]).toBeTruthy()
  })

  it('sin shell ni texto de la persona: argumentos y variables fijos, sin intérpretes, sin inyección', () => {
    for (const c of locals()) {
      expect(c.runtime.entry, c.id).not.toMatch(/(^|\/)(sh|bash|zsh|cmd|powershell|pwsh)(\.exe)?$/i)
      expect(c.inputs, c.id).toEqual([])
      for (const a of c.runtime.args) expect(a, c.id).toMatch(/^[A-Za-z0-9._,:=@+/-]+$/)
      for (const [k, v] of Object.entries(c.runtime.env)) {
        expect(k, c.id).not.toMatch(/^(PATH|HOME|NODE_OPTIONS|PYTHON|LD_|DYLD_|UV_|NPM_)/)
        expect(v.split('{dir}').join(''), `${c.id}.${k}`).toMatch(/^[A-Za-z0-9._:/@=,-]*$/)
      }
    }
    for (const arg of ['-c', '-e', '--eval', '$(id)', 'a;b', 'a b', '`id`', 'a|b', 'a&&b', "a'b", '../x', ''])
      expect(
        rt((r) => r.args.push(arg)),
        JSON.stringify(arg)
      ).toMatch(/argumento no permitido/)
    expect(rt((r) => (r.env.NODE_OPTIONS = '--require=x'))).toMatch(/no permitida/)
    expect(rt((r) => (r.env.PATH = '/tmp'))).toMatch(/no permitida/)
    expect(rt((r) => (r.env.LD_PRELOAD = '/tmp/x.so'))).toMatch(/no permitida/)
    expect(rt((r) => (r.env.WORKSPACE_MCP_X = '$(id)'))).toMatch(/valor no permitido/)
    expect(rt((r) => (r.env.WORKSPACE_MCP_X = 'a b'))).toMatch(/valor no permitido/)
    expect(rt((r) => (r.entry = '../../bin/sh'))).toMatch(/entry/)
    expect(rt((r) => (r.entry = '/bin/sh'))).toMatch(/entry/)
    expect(rt((r) => (r.manager = 'sh'))).toMatch(/manager/)
    expect(rt((r) => (r.package = 'a b'))).toMatch(/package/)
    expect(rt((r) => (r.shell = true))).toMatch(/clave desconocida/)
    // un conector local no puede pedir texto a la persona
    expect(
      errorsWith((c) => {
        localOf(c).inputs = [
          { id: 'x', label: 'x', kind: 'text', pattern: '^.*$', maxLength: 10, target: { header: 'X', template: '{value}' } }
        ]
      })
    ).toMatch(/inputs/)
  })

  it('solo consulta: «writes» falso, auth «account», y las herramientas permitidas y bloqueadas no se cruzan', () => {
    for (const c of locals()) {
      expect(c.writes, c.id).toBe(false)
      expect(c.auth, c.id).toBe('account')
      const { allowed, blocked, auth } = c.runtime.tools
      expect(
        allowed.filter((t) => blocked.includes(t)),
        c.id
      ).toEqual([])
      expect(
        auth.every((t) => allowed.includes(t)),
        c.id
      ).toBe(true)
      expect(blocked.length, c.id).toBeGreaterThan(5)
    }
    expect(errorsWith((c) => (localOf(c).writes = true))).toMatch(/solo consulta/)
    expect(rt((r) => r.tools.blocked.push(r.tools.allowed[0]))).toMatch(/permitidas y bloqueadas/)
  })

  it('ninguna herramienta que cambia algo está permitida (nombres típicos de escritura)', () => {
    const writes =
      /(^|[_-])(send|create|delete|update|modify|move|copy|import|upload|write|manage|set|share|remove|trash|forward|reply|draft|rename|accept|decline|logout)([_-]|$)/i
    for (const c of locals()) {
      const bad = c.runtime.tools.allowed.filter((t) => writes.test(t))
      expect(bad, c.id).toEqual([])
    }
  })

  it('declara quién la publica: autor, licencia libre, código fuente, de dónde descarga y cuánto pesa', () => {
    for (const c of locals()) {
      expect(c.runtime.author.length, c.id).toBeGreaterThan(2)
      expect(c.runtime.license, c.id).toBe('MIT')
      expect(c.runtime.sourceUrl, c.id).toMatch(/^https:\/\/github\.com\//)
      expect(c.runtime.downloadFrom.length, c.id).toBeGreaterThan(0)
      expect(c.runtime.approxMB, c.id).toBeGreaterThan(10)
      expect(c.runtime.platforms, c.id).toEqual(['darwin'])
    }
  })

  it('los remotos no llevan «runtime», los locales no llevan «url» y «account» es solo de los locales', () => {
    expect(
      errorsWith((c) => {
        c.connectors[0].runtime = localOf(clone()).runtime
      })
    ).toMatch(/runtime/)
    expect(errorsWith((c) => (localOf(c).url = 'https://x.example.com/mcp'))).toMatch(/url/)
    expect(errorsWith((c) => (c.connectors[0].auth = 'account'))).toMatch(/account/)
  })

  it('el cliente OAuth de la persona va en un archivo: su variable no está en «env» y no hay secretos en el catálogo', () => {
    const g = locals().find((c) => c.id === 'google-workspace')!
    expect(g.runtime.clientFile).toEqual({
      env: 'GOOGLE_CLIENT_SECRET_PATH',
      file: 'client_secret.json',
      helpUrl: 'https://console.cloud.google.com/apis/credentials'
    })
    expect(Object.keys(g.runtime.env)).not.toContain('GOOGLE_CLIENT_SECRET_PATH')
    for (const c of locals()) expect(Object.keys(c.runtime.env).join(), c.id).not.toMatch(/SECRET|TOKEN_VALUE|PASSWORD|API_KEY/i)
    expect(rt((r) => (r.env.GOOGLE_CLIENT_SECRET_PATH = '/tmp/x'))).toMatch(/clientFile/)
  })

  it('textos en español e inglés: ficha, pasos de preparación, cómo entrar y avisos del asistente', () => {
    const E = es as unknown as Record<string, string>
    const N = en as unknown as Record<string, string>
    for (const c of locals()) {
      for (const k of [
        `mcp.cat.${c.id}.title`,
        `mcp.cat.${c.id}.description`,
        `mcp.cat.${c.id}.leaves`,
        `pers.cat.conn.${c.id}.signin`,
        `pers.cat.conn.${c.id}.prep1`,
        `pers.cat.conn.${c.id}.prepNote`
      ]) {
        expect(E[k], k).toBeTruthy()
        expect(N[k], k).toBeTruthy()
      }
      c.capabilities.forEach((x, i) => expect(E[`mcp.cat.${c.id}.cap${i + 1}`], c.id).toBe(x))
      expect(E[`mcp.cat.${c.id}.title`]).toBe(c.title)
      expect(E[`mcp.cat.${c.id}.description`]).toBe(c.description)
      c.cannot.forEach((x, i) => expect(E[`pers.cat.conn.${c.id}.cannot${i + 1}`], c.id).toBe(x))
    }
    for (const k of [
      'pers.local.ackThird',
      'pers.local.ackData',
      'pers.local.sandbox',
      'pers.local.fact.verify',
      'pers.local.removeMessage'
    ]) {
      expect(E[k], k).toBeTruthy()
      expect(N[k], k).toBeTruthy()
    }
    // La casilla específica pedida por el dueño, con su texto exacto.
    expect(E['pers.local.ackThird']).toBe('Entiendo que esto instala un programa de un tercero.')
  })
})
