import { describe, expect, it } from 'vitest'
import { buildAuditEntry } from './audit'
import { auditInputFromEvent } from './audit-event'

describe('del evento del canal lateral al registro', () => {
  it('solo registra los finales de acción', () => {
    expect(auditInputFromEvent({ tool: 'left_click', x: 1, y: 2 })).toBeNull()
    expect(auditInputFromEvent({ tool: 'left_click', x: 1, y: 2, phase: 'start' })).toBeNull()
  })

  it('clic: herramienta, coordenadas y resultado', () => {
    const e = buildAuditEntry(auditInputFromEvent({ tool: 'left_click', x: 10, y: 20, phase: 'end', ok: true, at: 5 })!)
    expect(e).toMatchObject({ tool: 'left_click', x: 10, y: 20, outcome: 'ok', textLen: null, keyCombo: null })
    expect(buildAuditEntry(auditInputFromEvent({ tool: 'left_click', phase: 'end', ok: false })!).outcome).toBe('error')
  })

  it('type_text: solo la longitud; el texto no llega ni a la entrada ni a su serialización', () => {
    const input = auditInputFromEvent({ tool: 'type_text', text: 'secreto123', phase: 'end', ok: true })!
    const e = buildAuditEntry(input)
    expect(e.textLen).toBe(10)
    expect(JSON.stringify(e)).not.toContain('secreto123')
  })

  it('key: la combinación; app_* y open_application: nada del texto (nombres de apps, valores de la interfaz)', () => {
    expect(buildAuditEntry(auditInputFromEvent({ tool: 'key', text: 'ctrl+c', phase: 'end' })!).keyCombo).toBe('ctrl+c')
    const e = buildAuditEntry(auditInputFromEvent({ tool: 'app_set_value', text: 'Banco ref-3', phase: 'end', ok: true })!)
    expect(JSON.stringify(e)).not.toContain('Banco')
    expect(e.textLen).toBeNull()
  })

  it('una captura sin `ok` cuenta como correcta', () => {
    expect(buildAuditEntry(auditInputFromEvent({ tool: 'screenshot', phase: 'end' })!).outcome).toBe('ok')
  })
})
