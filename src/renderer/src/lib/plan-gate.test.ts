import { describe, expect, it } from 'vitest'
import { friendlyToolError, isPlanGateText } from './plan-gate'

describe('plan-gate', () => {
  it('reconoce el bloqueo del plan con y sin tilde, sin depender de la herramienta ni del MCP', () => {
    expect(isPlanGateText('Todavia no hay un plan aprobado para esta tarea (flujo Plan -> Aprobar -> Ejecutar).')).toBe(true)
    expect(isPlanGateText('Todavía no hay un plan aprobado para esta tarea (flujo Plan → Aprobar → Ejecutar).')).toBe(true)
  })
  it('no confunde otros errores', () => {
    expect(isPlanGateText('ECONNREFUSED 127.0.0.1:5432')).toBe(false)
    expect(isPlanGateText(undefined)).toBe(false)
    expect(friendlyToolError('ECONNREFUSED 127.0.0.1:5432')).toBe('ECONNREFUSED 127.0.0.1:5432')
  })
  it('explica en llano un fallo crudo del sistema de cualquier herramienta (una línea); Code lo conserva', () => {
    for (const raw of ["EPERM: operation not permitted, open '/x/a.txt'", "ENOENT: no such file or directory, open 'b'", 'ENOSPC: no space left on device']) {
      const out = friendlyToolError(raw)
      expect(out).not.toMatch(/E[A-Z]{3,6}\b/)
      expect(out).toMatch(/Vuelve a intentarlo|Revisa|Libera/)
      expect(friendlyToolError(raw, true)).toBe(raw)
    }
    const salida = 'npm ERR! ENOENT\nnpm ERR! path /x/package.json'
    expect(friendlyToolError(salida)).toBe(salida)
  })
  it('cambia el texto técnico por un aviso claro', () => {
    const out = friendlyToolError('Todavia no hay un plan aprobado para esta tarea (flujo Plan -> Aprobar -> Ejecutar).')
    expect(out).not.toMatch(/computer_request_access|flujo Plan/)
    expect(out).toMatch(/aprobaci/i)
  })
})
