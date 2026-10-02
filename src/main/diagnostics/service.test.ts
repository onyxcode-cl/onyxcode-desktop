import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appAuthFile, opencodeDataHome } from '../opencode/data-dir'
import { DiagnosticsService, ENGINE_FILE_TAIL_BYTES, exportFileName, newestLog, readFileTail, type DiagnosticsDeps } from './service'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diag-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const PASSWORD = 'pw-sidecar-0123456789abcdef'
const AUTH = `Basic ${Buffer.from(`onyxcode:${PASSWORD}`).toString('base64')}`

function setup(extra: Partial<DiagnosticsDeps> = {}, engineLines: string[] = []): DiagnosticsService {
  const userData = join(dir, 'ud')
  mkdirSync(join(appAuthFile(userData), '..'), { recursive: true })
  writeFileSync(appAuthFile(userData), JSON.stringify({ openai: { type: 'api', key: 'clave-openai-guardada-1' } }))
  writeFileSync(
    join(userData, 'opencode.json'),
    JSON.stringify({ mcp: { gh: { type: 'remote', url: 'https://x', headers: { Authorization: 'Bearer mcp-secreto-77' } } } })
  )
  return new DiagnosticsService({
    userData,
    home: '/Users/ana',
    mcpConfigPath: join(userData, 'opencode.json'),
    server: {
      recentLog: (max) => (max ? engineLines.slice(-max) : engineLines),
      secrets: () => [PASSWORD, AUTH, AUTH.slice(6)],
      getStatus: () => ({ state: 'ready', restarts: 2, version: '1.18.32', error: `fallo previo con ${PASSWORD}` })
    },
    versions: () => ({ OnyxCode: '0.3.0', electron: '44' }),
    now: () => Date.UTC(2026, 9, 1, 15, 30),
    ...extra
  })
}

const SECRETS = [PASSWORD, AUTH, 'clave-openai-guardada-1', 'mcp-secreto-77', 'sk-ant-api03-ABCDEFGH12345678', '/Users/ana']
const dirty = [
  `level=info password=${PASSWORD} ok`,
  `Authorization: ${AUTH}`,
  'usó clave-openai-guardada-1 en la petición',
  'header Bearer mcp-secreto-77',
  'otra sk-ant-api03-ABCDEFGH12345678',
  'leyó /Users/ana/Documents/x'
]

describe('DiagnosticsService', () => {
  it('engine: devuelve las líneas redactadas y respeta maxLines', () => {
    const s = setup({}, dirty)
    const r = s.getLogs('engine', 3)
    expect(r.source).toBe('engine')
    expect(r.lines).toHaveLength(3)
    expect(r.truncated).toBe(true)
    const all = s.getLogs('engine').lines.join('\n')
    for (const secret of SECRETS) expect(all).not.toContain(secret)
    expect(all).toContain('~/Documents/x')
  })

  it('engine-file: lee solo el final del .log más reciente y redacta', () => {
    const s = setup()
    const logDir = join(opencodeDataHome(join(dir, 'ud')), 'opencode', 'log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'viejo.log'), 'antiguo\n')
    utimesSync(join(logDir, 'viejo.log'), new Date(2020, 1, 1), new Date(2020, 1, 1))
    const big = `${'relleno de linea larga '.repeat(20)}\n`.repeat(2000)
    writeFileSync(join(logDir, 'opencode.log'), `${big}${dirty.join('\n')}\n`)
    expect(newestLog(logDir)).toBe(join(logDir, 'opencode.log'))
    const r = s.getLogs('engine-file', 5000)
    expect(r.truncated).toBe(true)
    expect(r.lines.join('\n').length).toBeLessThanOrEqual(ENGINE_FILE_TAIL_BYTES + 10_000)
    expect(r.lines.some((l) => l.includes('antiguo'))).toBe(false)
    for (const secret of SECRETS) expect(r.lines.join('\n')).not.toContain(secret)
    // La primera línea (cortada por el offset) se descarta: todas empiezan completas.
    expect(r.lines[0].startsWith('relleno de linea larga')).toBe(true)
  })

  it('engine-file sin carpeta de registros: vacío', () => {
    expect(setup().getLogs('engine-file').lines).toEqual([])
  })

  it('report: versiones, estado y motor, todo redactado (también el último error)', () => {
    const s = setup({}, dirty)
    const text = s.getLogs('report', 1000).lines.join('\n')
    expect(text).toContain('electron: 44')
    expect(text).toContain('reinicios: 2')
    expect(text).toContain('estado: ready')
    for (const secret of SECRETS) expect(text).not.toContain(secret)
  })

  it('getText y getExport: texto redactado y nombre OnyxCode-diagnostico-AAAAMMDD-HHmm.txt', () => {
    const s = setup({}, dirty)
    const copy = s.getText('engine')
    expect(copy.lines).toBe(dirty.length)
    for (const secret of SECRETS) expect(copy.text).not.toContain(secret)
    const exp = s.getExport()
    expect(exp.fileName).toMatch(/^OnyxCode-diagnostico-\d{8}-\d{4}\.txt$/)
    for (const secret of SECRETS) expect(exp.text).not.toContain(secret)
    expect(exportFileName(new Date(2026, 0, 5, 9, 7).getTime())).toBe('OnyxCode-diagnostico-20260105-0907.txt')
  })

  it('readFileTail: sin truncar devuelve todo', () => {
    const f = join(dir, 'a.log')
    writeFileSync(f, 'a\nb\nc\n')
    expect(readFileTail(f, 1000)).toEqual({ lines: ['a', 'b', 'c'], truncated: false })
  })
})

describe('guardia estática: diag:* solo devuelve texto redactado', () => {
  const src = readFileSync(resolve(__dirname, '..', 'ipc', 'diagnostics.ts'), 'utf8')

  it('el handler no lee registros por su cuenta (solo DiagnosticsService)', () => {
    expect(src).not.toMatch(/readFile|createReadStream|recentLog|logRing|\.secrets\(\)/)
    for (const ch of ['diag:logs', 'diag:copy', 'diag:export']) expect(src).toContain(`'${ch}'`)
    expect(src).toMatch(/service\.getLogs\(/)
    expect(src).toMatch(/clipboard\.writeText\(text\)/)
    expect(src).toMatch(/writeFile\(r\.filePath, text,/)
  })

  it('solo service.ts importa el redactor y los registros crudos del motor', () => {
    const root = resolve(__dirname, '..')
    const users: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) walk(f)
        else if (/\.ts$/.test(n) && !n.endsWith('.test.ts') && /\.recentLog\(/.test(readFileSync(f, 'utf8')))
          users.push(f.slice(root.length).replace(/\\/g, '/'))
      }
    }
    walk(root)
    expect(users).toEqual(['/diagnostics/service.ts'])
  })
})
