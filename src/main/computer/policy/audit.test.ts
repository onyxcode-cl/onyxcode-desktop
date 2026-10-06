import { describe, expect, it } from 'vitest'
import { AUDIT_FILE, type AuditFs, buildAuditEntry, createAuditLog, parseAuditLines, serializeAuditEntry } from './audit'

const SECRET = 'secreto123-contraseña-🔑'

function memFs(failOn?: string): AuditFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    size: (p) => new TextEncoder().encode(files.get(p) ?? '').length,
    append: (p, d) => {
      if (failOn === 'append') throw new Error('disco lleno')
      files.set(p, (files.get(p) ?? '') + d)
    },
    rename: (a, b) => {
      files.set(b, files.get(a) ?? '')
      files.delete(a)
    },
    remove: (p) => void files.delete(p),
    mkdirp: () => {}
  }
}

describe('buildAuditEntry', () => {
  it('campos del plan, en orden', () => {
    const e = buildAuditEntry({
      at: 0,
      session: 's1',
      tool: 'left_click',
      appKey: 'aumid:x!y',
      appName: 'Calc',
      tier: 'click',
      x: 10.4,
      y: 20,
      outcome: 'ok'
    })
    expect(Object.keys(e)).toEqual([
      'at',
      'session',
      'tool',
      'appKey',
      'appName',
      'tier',
      'x',
      'y',
      'textLen',
      'keyCombo',
      'outcome',
      'reason'
    ])
    expect(e).toMatchObject({ at: '1970-01-01T00:00:00.000Z', x: 10, y: 20, textLen: null, keyCombo: null, reason: null })
  })
  it('type_text: solo la longitud, nunca el texto (por grafema de código, emoji = 1)', () => {
    const e = buildAuditEntry({ tool: 'type_text', text: SECRET, outcome: 'ok' })
    expect(e.textLen).toBe([...SECRET].length)
    expect(serializeAuditEntry(e)).not.toContain('secreto')
    expect(serializeAuditEntry(e)).not.toContain('🔑')
  })
  it('ignora campos no listados (texto, captura, valor UIA)', () => {
    const raw = {
      tool: 'app_set_value',
      outcome: 'ok',
      value: SECRET,
      screenshot: 'data:image/png;base64,AAAA',
      uiaValue: SECRET,
      content: SECRET
    } as never
    const line = serializeAuditEntry(buildAuditEntry(raw))
    expect(line).not.toContain('secreto')
    expect(line).not.toContain('base64')
  })
  it('keyCombo solo con forma de combinación; si no, null', () => {
    expect(buildAuditEntry({ tool: 'key', keyCombo: 'Ctrl+C', outcome: 'ok' }).keyCombo).toBe('ctrl+c')
    expect(buildAuditEntry({ tool: 'key', keyCombo: 'secreto 123 con ñ', outcome: 'ok' }).keyCombo).toBeNull()
    expect(buildAuditEntry({ tool: 'key', keyCombo: 'a'.repeat(200), outcome: 'ok' }).keyCombo).toBeNull()
  })
  it('recorta y limpia; outcome/tier desconocidos se normalizan', () => {
    const e = buildAuditEntry({ tool: 't\nx', appName: 'a'.repeat(500), reason: 'r'.repeat(500), outcome: 'raro', tier: 'root' })
    expect(e.tool).toBe('t x')
    expect(e.appName).toHaveLength(120)
    expect(e.reason).toHaveLength(200)
    expect([e.outcome, e.tier]).toEqual(['error', null])
  })
  it('números no finitos -> null; hora por defecto del reloj inyectado', () => {
    const e = buildAuditEntry({ tool: 'x', x: NaN, y: Infinity, textLen: -3, outcome: 'ok' }, () => 86_400_000)
    expect([e.x, e.y, e.textLen, e.at]).toEqual([null, null, null, '1970-01-02T00:00:00.000Z'])
  })
})

describe('createAuditLog: rotación 5 MB × 3', () => {
  it('escribe una línea JSON por entrada', () => {
    const fs = memFs()
    const log = createAuditLog('/ud', fs, { now: () => 0 })
    expect(log.write({ tool: 'key', keyCombo: 'ctrl+c', outcome: 'ok' })).toBe(true)
    const text = fs.files.get(`/ud/${AUDIT_FILE}`)!
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text).tool).toBe('key')
  })
  it('rota al superar el máximo y conserva como mucho 3 archivos (el más viejo se pierde)', () => {
    const fs = memFs()
    let n = 0
    const log = createAuditLog('/ud', fs, { now: () => 0, maxBytes: 600, files: 3 })
    for (; n < 40; n++) log.write({ session: `s${n}`, tool: 'left_click', outcome: 'ok' })
    expect([...fs.files.keys()].sort()).toEqual([`/ud/${AUDIT_FILE}`, `/ud/${AUDIT_FILE}.1`, `/ud/${AUDIT_FILE}.2`])
    for (const t of fs.files.values()) expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(600)
    const cur = parseAuditLines(fs.files.get(`/ud/${AUDIT_FILE}`)!)
    const old = parseAuditLines(fs.files.get(`/ud/${AUDIT_FILE}.1`)!)
    expect(cur.at(-1)?.session).toBe('s39')
    expect(old.at(-1)!.session < cur[0].session || Number(old.at(-1)!.session.slice(1)) < Number(cur[0].session.slice(1))).toBe(true)
  })
  it('tamaños por defecto: 5 MB y 3 archivos', () => {
    const fs = memFs()
    const log = createAuditLog('C:\\ud', fs)
    expect(log.paths()).toEqual(['C:\\ud\\computer-audit.jsonl', 'C:\\ud\\computer-audit.jsonl.1', 'C:\\ud\\computer-audit.jsonl.2'])
  })
  it('un fallo de disco no lanza: devuelve false', () => {
    const log = createAuditLog('/ud', memFs('append'))
    expect(log.write({ tool: 'x', outcome: 'ok' })).toBe(false)
  })
  it('tras teclear «secreto123» el archivo no lo contiene (S11)', () => {
    const fs = memFs()
    const log = createAuditLog('/ud', fs)
    log.write({ tool: 'type_text', text: 'secreto123', appName: 'Bloc de notas', outcome: 'ok', session: 's' })
    for (const t of fs.files.values()) expect(t).not.toContain('secreto123')
  })
})

describe('parseAuditLines', () => {
  it('descarta basura y no admite que un `text` colado se refleje', () => {
    const good = serializeAuditEntry(buildAuditEntry({ tool: 'key', outcome: 'ok' }))
    const evil = JSON.stringify({ at: '2020-01-01T00:00:00.000Z', tool: 'type_text', outcome: 'ok', text: SECRET, value: SECRET }) + '\n'
    const out = parseAuditLines(`${good}no json\n{"a":1}\n${evil}\n`)
    expect(out).toHaveLength(2)
    expect(JSON.stringify(out)).not.toContain('secreto')
  })
})
