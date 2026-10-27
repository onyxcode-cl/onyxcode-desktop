// @vitest-environment jsdom
/**
 * Tarjeta de escalada por app: título propio («Esta tarea necesita {App}», no el de la tarjeta de permiso), app bloqueada
 * (lista fija, denegada guardada, negada en la tarea) = aviso de bloqueo y SIN botón de escalar, motivo recortado y HTML del
 * agente como texto, nombre enorme sin tarjeta, y nombres de las apps fijas en inglés.
 */
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const setAccessMode = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./actions', () => ({
  reveal: vi.fn(() => Promise.resolve()),
  sendToTask: vi.fn(() => Promise.resolve()),
  setAccessMode
}))
vi.mock('./store', async () => {
  const { create } = await import('zustand')
  return {
    useTasks: create(() => ({ folder: '/tmp/carpeta', grants: null, blockedApps: {}, fullAccess: false })),
    currentTasksModel: () => undefined
  }
})
vi.mock('./transcript', () => ({ firstUserPrompt: () => 'encargo' }))
vi.mock('../../../stores/ui', () => ({ useUi: { getState: () => ({ openSettingsAt: vi.fn() }) } }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setI18nPlatform, setLang } from '@shared/i18n'
import { MAC_FIXED_BLOCKED, WIN_FIXED_BLOCKED, labeledAppName } from '@shared/blocked-apps'
import { DICTIONARIES } from '@shared/i18n'
import { useLang } from '../../../lib/i18n'
import type { MessageEntry } from '../../../stores/sessions'
import { useTasks } from './store'
import { blockedKindFor, buildContinuationPrompt, EscalateCard, MAX_REASON_CHARS, parseEscalation } from './EscalateCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const assistant = (text: string): MessageEntry =>
  ({ info: { id: 'a1', role: 'assistant' }, parts: [{ id: 'p1', type: 'text', text }] }) as unknown as MessageEntry
const set = (s: Record<string, unknown>): void => {
  act(() => (useTasks as unknown as { setState: (s: unknown) => void }).setState(s))
}
const render = (text: string, lang: 'es' | 'en' = 'es', p: 'darwin' | 'win32' = 'darwin'): void => {
  ;(window as unknown as { api: unknown }).api = { platform: p, capsFlags: {} }
  setI18nPlatform(p)
  setLang(lang)
  useLang.setState({ lang })
  act(() => root.render(createElement(EscalateCard, { taskId: 't1', entries: [assistant(text)] })))
}
const btn = (re: RegExp): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((b) => re.test(b.textContent ?? ''))

beforeEach(() => {
  setAccessMode.mockClear()
  set({ folder: '/tmp/carpeta', grants: null, blockedApps: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('EscalateCard (app)', () => {
  it('usa un título distinto al de la tarjeta de permiso: el botón cambia el alcance, no concede la app', () => {
    render('Para mandarlo\n[[LAZUNOX:NEEDS_APP:Discord]]')
    expect(host.textContent).toContain('Esta tarea necesita Discord')
    expect(host.textContent).not.toContain('¿Permitir que Lazunox use Discord?')
    expect(btn(/Cambiar a El computador completo y continuar/)).toBeTruthy()
    render('To send it\n[[LAZUNOX:NEEDS_APP:Discord]]', 'en')
    expect(host.textContent).toContain('This task needs Discord')
    expect(host.textContent).not.toContain('Allow Lazunox to use')
  })

  it('app de la lista fija: aviso de bloqueo y SIN botón de escalar (ni en inglés ni con otro nombre)', () => {
    render('Necesito claves\n[[LAZUNOX:NEEDS_APP:Bitwarden]]')
    expect(host.querySelector('[data-blocked-kind="fixed"]')).toBeTruthy()
    expect(host.textContent).toContain('Bitwarden está bloqueada por seguridad')
    expect(btn(/Cambiar a/)).toBeUndefined()
    render('Need passwords\n[[LAZUNOX:NEEDS_APP:Passwords]]', 'en')
    expect(host.querySelector('[data-blocked-kind="fixed"]')).toBeTruthy()
    expect(btn(/Switch to/)).toBeUndefined()
  })

  it('app bloqueada por la persona (denegada guardada): aviso «user» con botón de desbloqueo, sin escalar', () => {
    set({ grants: { grants: [], denied: ['com.acme.cartera'], deniedNames: { 'com.acme.cartera': 'Cartera Acme' } } })
    render('Pagar\n[[LAZUNOX:NEEDS_APP:cartera acme]]')
    expect(host.querySelector('[data-blocked-kind="user"]')).toBeTruthy()
    expect(btn(/Desbloquear/)).toBeTruthy()
    expect(btn(/Cambiar a/)).toBeUndefined()
  })

  it('app negada en esta tarea (aviso ya recibido): tampoco se ofrece escalar', () => {
    set({ blockedApps: { t1: [{ bundleId: 'com.x.sheet', name: 'Hojas', kind: 'session' }] } })
    render('Leer\n[[LAZUNOX:NEEDS_APP:Hojas]]')
    expect(host.querySelector('[data-blocked-kind="session"]')).toBeTruthy()
    expect(btn(/Cambiar a/)).toBeUndefined()
  })

  it('app normal: botón de escalar y NO abre el diálogo hasta pulsarlo', () => {
    render('Mandar\n[[LAZUNOX:NEEDS_APP:Discord]]')
    expect(setAccessMode).not.toHaveBeenCalled()
    act(() => btn(/Cambiar a/)!.click())
    expect(setAccessMode).toHaveBeenCalledWith(true)
  })

  it('el motivo se recorta y el HTML del agente se muestra como texto, no se interpreta', () => {
    const reason = `<img src=x onerror=alert(1)> <b>negrita</b> ${'muy largo '.repeat(100)}`
    render(`${reason}\n[[LAZUNOX:NEEDS_APP:Discord]]`)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('b')).toBeNull()
    const p = Array.from(host.querySelectorAll('p')).find((x) => x.textContent?.includes('<img'))
    expect(p).toBeTruthy()
    expect((p?.textContent ?? '').length).toBeLessThanOrEqual(MAX_REASON_CHARS)
    expect(p?.textContent).toMatch(/…$/)
  })

  it('un nombre de app enorme no genera tarjeta (el marcador admite hasta 60 caracteres)', () => {
    render(`Motivo\n[[LAZUNOX:NEEDS_APP:${'A'.repeat(500)}]]`)
    expect(host.textContent).toBe('')
    expect(parseEscalation(`m\n[[LAZUNOX:NEEDS_APP:${'A'.repeat(61)}]]`)).toBeNull()
    expect(parseEscalation(`m\n[[LAZUNOX:NEEDS_APP:${'A'.repeat(60)}]]`)?.app).toHaveLength(60)
  })

  it('el motivo de «Control total» y de «abrir carpeta» también se recorta', () => {
    const long = 'x'.repeat(1000)
    expect(parseEscalation(`${long}\n[[LAZUNOX:OPEN_FOLDER]]`)?.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS)
    expect(parseEscalation(`**Necesita Control total del Mac**: ${long}`)?.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS)
  })
})

describe('buildContinuationPrompt (app)', () => {
  const entries = [
    { info: { id: 'u1', role: 'user' }, parts: [{ id: 'q', type: 'text', text: 'Escribe a Fulano' }] },
    assistant('Borrador listo')
  ] as unknown as MessageEntry[]
  it('dice lo que PIDIÓ EL AGENTE, no pone sus palabras como si fueran de la persona', () => {
    const es = buildContinuationPrompt(entries, 'es', 'Discord')
    expect(es).toContain('El agente pidió usar: Discord')
    expect(es).not.toContain('que necesito que uses')
    const en = buildContinuationPrompt(entries, 'en', 'Discord')
    expect(en).toContain('The agent asked to use this app: Discord')
    expect(en).not.toContain('I need you to use')
  })
})

describe('apps bloqueadas fijas en inglés', () => {
  it('cada nombre traducible tiene clave en es y en, y en inglés no queda ningún nombre en español', () => {
    const en = DICTIONARIES.en
    const es = DICTIONARIES.es
    const t = (k: string): string => (en[k] as string) ?? `FALTA:${k}`
    for (const a of [...MAC_FIXED_BLOCKED, ...WIN_FIXED_BLOCKED]) {
      if (!a.nameKey) continue
      expect(es[a.nameKey], a.id).toBe(a.name)
      const name = labeledAppName(a, t as never)
      expect(name, a.id).not.toMatch(/^FALTA/)
      expect(name, a.id).not.toMatch(
        /[ñáéíóú]|Contraseñas|Pantalla|Seguridad de|Inicio de|Credenciales|Administrador|Consola|Editor del|Avisos|versión|antiguo/
      )
    }
    expect(labeledAppName({ id: 'x', name: 'Bitwarden' }, t as never)).toBe('Bitwarden')
  })

  it('blockedKindFor reconoce el nombre en inglés y en español, y no confunde apps parecidas', () => {
    const opts = (win: boolean) => ({
      grants: null,
      win,
      fixedName: (a: (typeof MAC_FIXED_BLOCKED)[number]) => labeledAppName(a, (k) => DICTIONARIES.en[k] as string)
    })
    expect(blockedKindFor('Passwords', opts(false))).toBe('fixed')
    expect(blockedKindFor('Contraseñas', opts(false))).toBe('fixed')
    expect(blockedKindFor('Task Manager', opts(true))).toBe('fixed')
    expect(blockedKindFor('regedit.exe', opts(true))).toBe('fixed')
    expect(blockedKindFor('Discord', opts(false))).toBeNull()
    expect(blockedKindFor('Mail', opts(false))).toBeNull()
  })
})
