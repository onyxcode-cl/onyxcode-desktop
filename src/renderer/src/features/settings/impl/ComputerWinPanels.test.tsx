/** Ajustes › Control del PC en Windows (C5): filas de «Estado en este PC» y registro. Vistas puras con `renderToStaticMarkup`. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate, type MsgKey, type Params } from '@shared/i18n'
import type { ComputerAuditRow, ComputerStatus } from '@shared/ipc-tasks'
import { AuditLogView, WinStatusView, auditDetail, winStatusRows } from './ComputerWinPanels'

const tEs = (k: MsgKey, p?: Params): string => translate('es', k, p)
const tEn = (k: MsgKey, p?: Params): string => translate('en', k, p)

const status = (o: Partial<ComputerStatus> = {}, win: Partial<NonNullable<ComputerStatus['win']>> = {}): ComputerStatus => ({
  helperOk: true,
  accessibility: true,
  screenRecording: true,
  screens: [],
  win: { consent: true, consentVersion: 1, consentStale: false, interactive: true, elevated: false, dpiPercent: 150, monitors: 2, ...win },
  ...o
})

const byId = (s: ComputerStatus | null, t = tEs): Record<string, { value: string; tone: string }> =>
  Object.fromEntries(winStatusRows(t, s).map((r) => [r.id, { value: r.value, tone: r.tone }]))

describe('Estado en este PC', () => {
  it('todo en orden: consentimiento, escritorio interactivo, sin administrador, helper, escalado y monitores', () => {
    const r = byId(status())
    expect(r.consent).toEqual({ value: 'Activado', tone: 'ok' })
    expect(r.session.tone).toBe('ok')
    expect(r.admin).toEqual({ value: 'Lazunox no se ejecuta como administrador', tone: 'ok' })
    expect(r.helper.tone).toBe('ok')
    expect(r.dpi.value).toBe('150 %')
    expect(r.monitors.value).toBe('2 (se controla solo el principal)')
  })

  it('administrador, sesión no interactiva, helper ausente y consentimiento caducado se ven como problemas', () => {
    const r = byId(status({ helperOk: false }, { consent: false, consentStale: true, interactive: false, elevated: true }))
    expect(r.consent.tone).toBe('warn')
    expect(r.consent.value).toContain('Caducado')
    expect(r.session.tone).toBe('warn')
    expect(r.admin.tone).toBe('error')
    expect(r.helper.value).toContain('antivirus')
  })

  it('sin estado todavía: «Sin comprobar» y sin filas inventadas de escalado o monitores', () => {
    const r = byId(null)
    expect(Object.keys(r)).toEqual(['consent', 'session', 'admin', 'helper'])
    expect(Object.values(r).every((x) => x.value === 'Sin comprobar' && x.tone === 'muted')).toBe(true)
  })

  it('la vista tiene el botón de volver a comprobar, que se desactiva mientras comprueba, y habla en inglés', () => {
    const html = (checking: boolean, t = tEs): string =>
      renderToStaticMarkup(createElement(WinStatusView, { t, status: status(), checking, onRecheck: vi.fn() }))
    expect(html(false)).toContain('Volver a comprobar')
    const disabled = (h: string): boolean => /<button[^>]*\sdisabled(=""|\s|>)/.test(h)
    expect(disabled(html(true))).toBe(true)
    expect(disabled(html(false))).toBe(false)
    expect(html(false, tEn)).toContain('Check again')
    expect(html(false, tEn)).toContain('Administrator rights')
  })
})

const row = (o: Partial<ComputerAuditRow> = {}): ComputerAuditRow => ({
  at: '2026-10-07T01:30:00.000Z',
  session: '',
  tool: 'left_click',
  appKey: null,
  appName: null,
  tier: null,
  x: null,
  y: null,
  textLen: null,
  keyCombo: null,
  outcome: 'ok',
  reason: null,
  ...o
})

describe('Registro de acciones', () => {
  it('vacío: lo dice; con entradas: tabla con encabezados y resultado', () => {
    expect(renderToStaticMarkup(createElement(AuditLogView, { t: tEs, rows: [] }))).toContain('Todavía no hay acciones registradas')
    const h = renderToStaticMarkup(
      createElement(AuditLogView, { t: tEs, rows: [row({ x: 10, y: 20 }), row({ tool: 'type_text', textLen: 10, outcome: 'error' })] })
    )
    expect(h).toContain('<table')
    expect(h).toContain('scope="col"')
    expect(h).toContain('left_click')
    expect(h).toContain('10, 20')
    expect(h).toContain('10 caracteres')
    expect(h).toContain('Con error')
  })

  it('el detalle nunca incluye texto tecleado: solo coordenadas, combinación, longitud, app y motivo', () => {
    expect(auditDetail(tEs, row({ tool: 'key', keyCombo: 'ctrl+c' }))).toBe('ctrl+c')
    expect(auditDetail(tEs, row({ tool: 'type_text', textLen: 3, reason: 'x' }))).toBe('3 caracteres · x')
    expect(auditDetail(tEs, row())).toBe('')
  })
})
