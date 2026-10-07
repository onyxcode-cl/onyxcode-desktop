/** Beta de Tareas en Windows (Ajustes › General): aviso honesto, casilla, armado de 600 ms, estados y plataforma inyectada. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { DICTIONARIES, setI18nPlatform, t as tr } from '@shared/i18n'
import type { TasksWinBetaState } from '@shared/ipc-tasks'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { consentUiArmed, CONSENT_UI_ARM_MS } from '../../tasks/impl/ComputerConsentWin'
import { betaStatusKey, TasksWinBetaRow, TasksWinBetaView, type TasksWinBetaViewProps } from './TasksWinBeta'
import { ComputerSection } from './ComputerSection'

const setPlatform = (platform: string, flags: Record<string, boolean> = {}): void => {
  ;(globalThis as { window?: unknown }).window = { api: { platform, capsFlags: flags, tasks: { invoke: vi.fn(), on: vi.fn() } } }
  setI18nPlatform(platform === 'win32' ? 'win32' : 'darwin')
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  setI18nPlatform('darwin')
})

const STATE: TasksWinBetaState = {
  available: true,
  consent: false,
  version: 1,
  stale: false,
  armed: false,
  active: false,
  restartRequired: false
}
const view = (over: Partial<TasksWinBetaViewProps> = {}, state: Partial<TasksWinBetaState> = {}): string =>
  renderToStaticMarkup(
    <TasksWinBetaView
      t={(k, p) => tr(k, p)}
      state={{ ...STATE, ...state }}
      dialog={false}
      checked={false}
      armed={false}
      busy={false}
      message={null}
      onOpen={() => undefined}
      onCancel={() => undefined}
      onCheck={() => undefined}
      onAccept={() => undefined}
      onRevoke={() => undefined}
      onRestart={() => undefined}
      {...over}
    />
  )

describe('armado de 600 ms (renderer)', () => {
  it('casilla + tiempo; ni lo uno ni lo otro bastan', () => {
    expect(CONSENT_UI_ARM_MS).toBe(600)
    expect(consentUiArmed(true, 1000, 1599)).toBe(false)
    expect(consentUiArmed(true, 1000, 1600)).toBe(true)
    expect(consentUiArmed(false, 1000, 9999)).toBe(false)
    expect(consentUiArmed(true, null, 9999)).toBe(false)
  })
})

describe('TasksWinBetaView', () => {
  it('estado inicial: «Apagada» y el botón que abre el aviso; sin diálogo', () => {
    setPlatform('win32')
    const html = view()
    expect(html).toContain('Tareas (beta) en Windows')
    expect(html).toContain('Apagada.')
    expect(html).toContain('Leer el aviso y activar')
    expect(html).not.toContain('alertdialog')
    expect(html).not.toContain('Reiniciar ahora')
  })

  it('el aviso nombra lo verificado y lo NO verificado, sin eufemismos', () => {
    setPlatform('win32')
    const html = view({ dialog: true })
    for (const frag of [
      '38 pruebas',
      '2 de 2',
      'A1–A20',
      'dos sesiones',
      'fallo abierto de WSL',
      'A3',
      'no tienen firma',
      'auditoría de seguridad externa',
      'SendInput',
      'UI Automation',
      'máscara',
      'STOP',
      'EOF',
      'Defender',
      'SmartScreen',
      'Entiendo',
      'Aceptar y activar'
    ]) {
      expect(html, frag).toContain(frag)
    }
  })

  it('el botón «Aceptar» sigue desactivado hasta casilla + armado y no es un submit', () => {
    setPlatform('win32')
    const off = view({ dialog: true, checked: true, armed: false })
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<[^>]*>)*[^<]*Aceptar y activar/)
    const on = view({ dialog: true, checked: true, armed: true })
    expect(on).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<[^>]*>)*[^<]*Aceptar y activar/)
    // Sin atajo que acepte: no hay <form>, ni autofocus, y todos los botones son type="button".
    for (const h of [off, on]) {
      expect(h).not.toContain('<form')
      expect(h).not.toMatch(/autofocus|autoFocus/i)
      expect(h).not.toMatch(/<button(?![^>]*type="button")/)
    }
  })

  it('estados: activa, aceptada (reiniciar para activar), retirada (reiniciar para apagar) y aviso cambiado', () => {
    setPlatform('win32')
    expect(view({}, { consent: true, active: true })).toContain('Activa en este PC.')
    const pend = view({}, { consent: true, active: false, restartRequired: true })
    expect(pend).toContain('Reinicia Lazunox para activarla')
    expect(pend).toContain('Reiniciar ahora')
    expect(pend).toContain('Retirar mi consentimiento')
    const off = view({}, { consent: false, active: true, restartRequired: true })
    expect(off).toContain('Reinicia Lazunox para apagarla')
    expect(off).toContain('Reiniciar ahora')
    expect(view({}, { stale: true })).toContain('cambió desde que lo aceptaste')
    expect(betaStatusKey({ consent: false, active: false, restartRequired: false })).toBe('tasksSettings.beta.statusOff')
  })

  it('con la función no disponible no pinta nada', () => {
    expect(view({}, { available: false })).toBe('')
  })

  it('es y en: mismas claves (los términos de terceros los vigilan visible-terms y legacy-terms)', () => {
    const names = (l: 'es' | 'en'): string[] =>
      Object.keys(DICTIONARIES[l])
        .filter((k) => k.startsWith('tasksSettings.beta.'))
        .sort()
    expect(names('en')).toEqual(names('es'))
    for (const lang of ['es', 'en'] as const) {
      const keys = Object.keys(DICTIONARIES[lang]).filter((k) => k.startsWith('tasksSettings.beta.'))
      expect(keys.length).toBeGreaterThanOrEqual(30)
    }
  })
})

describe('TasksWinBetaRow (plataforma inyectada)', () => {
  it('macOS: no muestra nada ni llama a main', () => {
    setPlatform('darwin')
    expect(renderToStaticMarkup(<TasksWinBetaRow />)).toBe('')
    expect(renderToStaticMarkup(<TasksWinBetaRow standalone />)).toBe('')
    const api = (globalThis as unknown as { window: { api: { tasks: { invoke: ReturnType<typeof vi.fn> } } } }).window.api
    expect(api.tasks.invoke).not.toHaveBeenCalled()
  })
  it('Windows: sin estado de main todavía no pinta nada (main decide si está disponible)', () => {
    setPlatform('win32')
    expect(renderToStaticMarkup(<TasksWinBetaRow />)).toBe('')
  })
})

describe('GeneralSection y ComputerSection', () => {
  it('GeneralSection ya no usa settings.tasksWinBeta ni la bandera de compilación en el renderer', () => {
    const src = readFileSync(join(__dirname, 'GeneralSection.tsx'), 'utf8')
    expect(src).not.toMatch(/tasksWinBeta/)
    expect(src).not.toMatch(/TASKS_WIN_BUILD/)
    expect(readFileSync(join(__dirname, 'TasksWinBeta.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /settings\.tasksWinBeta|update\(\{ tasksWinBeta/
    )
  })
  it('Control del PC en Windows sin Tareas (beta): solo la nota «requiere Tareas (beta)»', () => {
    setPlatform('win32', {})
    const html = renderToStaticMarkup(<ComputerSection />)
    expect(html).toContain('requiere Tareas (beta)')
    expect(html).not.toContain('Cómo usa el agente las apps')
  })
  it('macOS no cambia: sin la nota', () => {
    setPlatform('darwin')
    const html = renderToStaticMarkup(<ComputerSection />)
    expect(html).not.toContain('requiere Tareas (beta)')
    expect(html).toContain('Control del Mac')
  })
})
