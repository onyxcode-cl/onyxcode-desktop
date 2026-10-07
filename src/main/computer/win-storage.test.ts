import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuditLog } from './policy/audit'
import { createConsentController, WIN_CONSENT_VERSION } from './policy/consent-win'
import { createFileConsentStore, nodeAuditFs, readAuditEntries } from './win-storage'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'winstore-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('consentimiento en disco', () => {
  it('sin archivo, con basura o de otra versión: sin consentimiento (falla cerrado)', () => {
    const file = join(dir, 'c.json')
    const store = createFileConsentStore(file)
    const c = createConsentController(store, () => 1_000)
    expect(c.view()).toEqual({ consent: false, version: WIN_CONSENT_VERSION, stale: false })
    writeFileSync(file, 'no es json')
    expect(c.view().consent).toBe(false)
    writeFileSync(file, JSON.stringify({ version: WIN_CONSENT_VERSION + 1, at: 5 }))
    expect(c.view()).toMatchObject({ consent: false, stale: true })
  })

  it('conceder (armado a los 600 ms con la casilla) se guarda; revocar borra el archivo', () => {
    const file = join(dir, 'c.json')
    let t = 1_000
    const c = createConsentController(createFileConsentStore(file), () => t)
    c.show()
    c.setChecked(true)
    t += 599
    expect(c.confirm()).toBe(false)
    expect(existsSync(file)).toBe(false)
    t += 1
    expect(c.confirm()).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: WIN_CONSENT_VERSION, at: t })
    expect(c.view().consent).toBe(true)
    c.revoke()
    expect(existsSync(file)).toBe(false)
    expect(c.view().consent).toBe(false)
  })
})

describe('registro auditable en disco', () => {
  it('escribe sin el texto tecleado y se lee de más reciente a más antigua', () => {
    let t = Date.parse('2026-10-01T00:00:00Z')
    const log = createAuditLog(dir, nodeAuditFs, { now: () => (t += 1000) })
    log.write({ tool: 'type_text', text: 'secreto123', outcome: 'ok' })
    log.write({ tool: 'left_click', x: 10.4, y: 20, outcome: 'error', reason: 'x' })
    const raw = readFileSync(join(dir, 'computer-audit.jsonl'), 'utf8')
    expect(raw).not.toContain('secreto123')
    const rows = readAuditEntries(dir)
    expect(rows.map((r) => r.tool)).toEqual(['left_click', 'type_text'])
    expect(rows[1].textLen).toBe(10)
  })

  it('rota a 3 archivos y el lector los une; sin registro devuelve []', () => {
    expect(readAuditEntries(dir)).toEqual([])
    const log = createAuditLog(dir, nodeAuditFs, { maxBytes: 400, files: 3 })
    for (let i = 0; i < 12; i++) log.write({ tool: `t${i}`, outcome: 'ok' })
    expect(existsSync(join(dir, 'computer-audit.jsonl.1'))).toBe(true)
    expect(existsSync(join(dir, 'computer-audit.jsonl.3'))).toBe(false)
    const rows = readAuditEntries(dir, 5)
    expect(rows).toHaveLength(5)
    expect(rows[0].tool).toBe('t11')
  })
})
