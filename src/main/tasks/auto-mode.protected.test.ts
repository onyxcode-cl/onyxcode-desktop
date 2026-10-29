import { describe, expect, it } from 'vitest'
import { classifyPermission } from './auto-mode'

const ctx = { mcpServers: ['crm'] }

describe('modo Auto y rutas protegidas del motor', () => {
  it('un bash de solo lectura se aprueba solo, pero NO si la petición trae lazunoxProtegido', () => {
    expect(classifyPermission({ permission: 'bash', patterns: ['ls -la'], metadata: { command: 'ls -la' } }, ctx).decision).toBe('allow')
    const v = classifyPermission({ permission: 'bash', patterns: ['ls -la'], metadata: { command: 'ls -la', lazunoxProtegido: true } }, ctx)
    expect(v.decision).toBe('ask')
  })
  it('un conector de solo lectura tampoco se aprueba solo si la petición es protegida', () => {
    expect(classifyPermission({ permission: 'crm_get_contact', patterns: ['*'], metadata: {} }, ctx).decision).toBe('allow')
    expect(classifyPermission({ permission: 'crm_get_contact', patterns: ['*'], metadata: { lazunoxProtegido: true } }, ctx).decision).toBe(
      'ask'
    )
  })
  it('solo el booleano true exacto cuenta (un texto no)', () => {
    expect(
      classifyPermission({ permission: 'bash', patterns: ['ls'], metadata: { command: 'ls', lazunoxProtegido: 'true' } }, ctx).decision
    ).toBe('allow')
  })
})

describe('equipo_* nunca se aprueba en automático', () => {
  it.each(['equipo_ejecutar', 'equipo_detener'])('%s pregunta siempre, aunque el comando parezca inocuo', (permission) => {
    const v = classifyPermission({ permission, patterns: ['ls'], metadata: { comando: 'ls' } }, { mcpServers: ['equipo'] })
    expect(v.decision).toBe('ask')
  })
})
