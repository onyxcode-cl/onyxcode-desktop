/**
 * Fija el COMPORTAMIENTO de las acciones del permiso en el celular antes de tocar el marcado (rediseño PWA, T0).
 * Orden del destructivo: decisiones-pwa #1 (Rechazar primero).
 */
import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { permActions, runPermAction, type PermReplyApi } from './perm-actions'

const ids = (a: ReturnType<typeof permActions>): string[] => a.map((x) => x.id)
const req = { id: 'per_1', sessionID: 's', permission: 'bash', patterns: ['ls'], metadata: {}, always: [] } as PermissionRequest

describe('permActions: orden y variantes', () => {
  it('destructivo: rechazar, permitir una vez (peligro) y con indicaciones; sin «siempre»', () => {
    const a = permActions({ danger: true, canAlways: false, noting: false })
    expect(ids(a)).toEqual(['reject', 'once', 'note'])
    expect(a[0].fullWidth).toBe(true)
    expect(a.find((x) => x.id === 'once')?.variant).toBe('danger')
  })
  it('destructivo nunca ofrece «siempre», aunque se pida', () => {
    expect(ids(permActions({ danger: true, canAlways: true, noting: false }))).not.toContain('always')
  })
  it('no destructivo con canAlways: una vez (primario, ancho completo), rechazar, indicaciones, siempre', () => {
    const a = permActions({ danger: false, canAlways: true, noting: false })
    expect(ids(a)).toEqual(['once', 'reject', 'note', 'always'])
    expect(a[0]).toMatchObject({ variant: 'primary', fullWidth: true })
    expect(a[3]).toMatchObject({ variant: 'outline', fullWidth: true, title: 'alwaysHint' })
  })
  it('sin canAlways (p. ej. disableAlwaysAllow) no hay «siempre»', () => {
    expect(ids(permActions({ danger: false, canAlways: false, noting: false }))).toEqual(['once', 'reject', 'note'])
  })
  it('con el cuadro de indicaciones abierto no se repite «con indicaciones»', () => {
    expect(ids(permActions({ danger: false, canAlways: true, noting: true }))).toEqual(['once', 'reject', 'always'])
    expect(ids(permActions({ danger: true, canAlways: false, noting: true }))).toEqual(['reject', 'once'])
  })
  it('otra carpeta: la tarjeta es FolderRequestCard, sin acciones aquí', () => {
    expect(permActions({ danger: false, canAlways: true, kind: 'folder', noting: false })).toEqual([])
  })
  it('textos: reutiliza las claves de siempre, sin textos nuevos', () => {
    const a = permActions({ danger: false, canAlways: true, noting: false })
    expect(a.map((x) => x.labelKey)).toEqual([
      'tasksComputer.perm.once',
      'tasksComputer.perm.reject',
      'tasksComputer.perm.rejectNote',
      'tasksComputer.perm.always'
    ])
  })
})

describe('runPermAction: qué respuesta envía cada acción', () => {
  const api = (): PermReplyApi & { replyPermission: ReturnType<typeof vi.fn>; replyPermissionAlways: ReturnType<typeof vi.fn> } => ({
    replyPermission: vi.fn().mockResolvedValue(undefined),
    replyPermissionAlways: vi.fn().mockResolvedValue(undefined)
  })
  it('once → replyPermission(id, once)', async () => {
    const a = api()
    await runPermAction('once', req, a)
    expect(a.replyPermission).toHaveBeenCalledWith('per_1', 'once')
    expect(a.replyPermissionAlways).not.toHaveBeenCalled()
  })
  it('always → replyPermissionAlways(solicitud)', async () => {
    const a = api()
    await runPermAction('always', req, a)
    expect(a.replyPermissionAlways).toHaveBeenCalledWith(req)
    expect(a.replyPermission).not.toHaveBeenCalled()
  })
  it('reject → replyPermission(id, reject) sin mensaje', async () => {
    const a = api()
    await runPermAction('reject', req, a, 'ignorado')
    expect(a.replyPermission).toHaveBeenCalledWith('per_1', 'reject')
  })
  it('note → rechazo con el mensaje recortado; vacío = rechazo simple', async () => {
    const a = api()
    await runPermAction('note', req, a, '  usa otra ruta ')
    expect(a.replyPermission).toHaveBeenCalledWith('per_1', 'reject', 'usa otra ruta')
    await runPermAction('note', req, a, '   ')
    expect(a.replyPermission).toHaveBeenLastCalledWith('per_1', 'reject', undefined)
  })
})
