/** Ajustes › Diagnóstico › «Estado del sistema»: vista por resumen/nivel y lógica de arreglos (permisos, ArtCraft, xcode-select). */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { translate, type MsgKey, type Params } from '@shared/i18n'
import type { DoctorItem, DoctorReport } from '@shared/doctor'
import { DoctorCardView, copyXcodeCommand, doctorController, XCODE_COMMAND, type DoctorApi, type DoctorCardViewProps } from './DoctorCard'

const tEs = (k: MsgKey, p?: Params): string => translate('es', k, p)
const tEn = (k: MsgKey, p?: Params): string => translate('en', k, p)

const rep = (items: DoctorItem[], overall: DoctorReport['overall'] = 'fail'): DoctorReport => ({ items, overall, at: 1 })

const view = (o: Partial<DoctorCardViewProps> = {}, t = tEs): string =>
  renderToStaticMarkup(
    createElement(DoctorCardView, {
      t,
      report: null,
      checking: false,
      error: false,
      fixing: null,
      copied: false,
      onRerun: vi.fn(),
      onFix: vi.fn(),
      onCopy: vi.fn(),
      ...o
    })
  )

describe('Estado del sistema › resumen', () => {
  it.each([
    ['ok', 'Todo en orden'],
    ['warn', 'Funciona, con algunas limitaciones'],
    ['fail', 'Falta algo importante']
  ] as const)('overall %s → «%s»', (overall, text) => {
    expect(view({ report: rep([], overall) })).toContain(text)
  })

  it('sin revisión todavía no muestra resumen ni lista', () => {
    const h = view({ report: null })
    expect(h).not.toContain('Todo en orden')
    expect(h).not.toContain('<ul')
    expect(h).toContain('Revisar de nuevo')
  })

  it('el título de la sección y el botón «Revisar de nuevo» siempre están', () => {
    const h = view({ report: rep([], 'ok') })
    expect(h).toContain('Estado del sistema')
    expect(h).toContain('Revisar de nuevo')
  })
})

describe('Estado del sistema › estados de carga y error', () => {
  it('mientras revisa muestra «Revisando…» y deshabilita el botón', () => {
    const h = view({ checking: true })
    expect(h).toContain('Revisando…')
    expect(h).toContain('disabled=""')
    expect(h).toContain('aria-busy="true"')
  })

  it('error del canal: mensaje y Reintentar', () => {
    const h = view({ error: true })
    expect(h).toContain('No se pudo revisar el sistema.')
    expect(h).toContain('role="alert"')
    expect(h).toContain('Reintentar')
  })

  it('en inglés también', () => {
    const h = view({ report: rep([], 'warn') }, tEn)
    expect(h).toContain('Works, with some limitations')
    expect(h).toContain('Check again')
  })
})

describe('Estado del sistema › un ítem por nivel', () => {
  const items: DoctorItem[] = [
    { id: 'macos', level: 'ok' },
    { id: 'accessibility', level: 'fail', fix: 'requestPermissions' },
    { id: 'keyboardTool', level: 'warn' },
    { id: 'craft', level: 'warn', fix: 'installCraft' },
    { id: 'git', level: 'warn', fix: 'xcodeSelect' },
    { id: 'screens', level: 'info', detail: 'Built-in Retina (2056×1329)' }
  ]

  it('cada nivel tiene su icono accesible', () => {
    const h = view({ report: rep(items) })
    expect(h).toContain('aria-label="Correcto"')
    expect(h).toContain('aria-label="Falla"')
    expect(h).toContain('aria-label="Aviso"')
    expect(h).toContain('aria-label="Información"')
  })

  it('muestra título y explicación corta del ítem', () => {
    const h = view({ report: rep(items) })
    expect(h).toContain('Permiso de Accesibilidad')
    expect(h).toContain('sin él el agente no puede controlar el Mac')
    expect(h).toContain('Faltan las herramientas de línea de comandos de Apple')
  })

  it('pone el botón de arreglo que corresponde a cada ítem', () => {
    const h = view({ report: rep(items) })
    expect(h).toContain('Dar permisos')
    expect(h).toContain('Instalar</button>')
    expect(h).toContain(XCODE_COMMAND)
    expect(h).toContain('Ábrelo en Terminal')
    expect(h).toContain('Copiar</button>')
  })

  it('un ítem sin arreglo no muestra botón', () => {
    const h = view({ report: rep([{ id: 'macos', level: 'ok' }], 'ok') })
    expect(h).not.toContain('Dar permisos')
    expect(h).not.toContain('Copiar')
  })

  it('screens muestra su detail como texto; el resto de ítems lo muestra como pista pequeña', () => {
    const h = view({ report: rep(items) })
    expect(h).toContain('Built-in Retina (2056×1329)')
    expect(h).toContain('mt-1 text-sm')
  })

  it('con un arreglo en curso los botones quedan deshabilitados', () => {
    const h = view({ report: rep(items), fixing: 'requestPermissions' })
    expect(h.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('xcodeSelect copiado cambia la etiqueta', () => {
    expect(view({ report: rep(items), copied: true })).toContain('Copiado')
  })

  it('en inglés el arreglo de ArtCraft tiene su texto', () => {
    expect(view({ report: rep(items) }, tEn)).toContain('Install</button>')
  })

  it('el texto de ArtCraft ok es «ArtCraft listo»', () => {
    expect(view({ report: rep([{ id: 'craft', level: 'ok' }], 'ok') })).toContain('ArtCraft listo')
    expect(tEs('settings.doctor.item.craft.warn')).toContain('no está instalado')
  })
})

describe('Estado del sistema › acciones', () => {
  const okReport = rep([{ id: 'accessibility', level: 'ok' }], 'ok')
  const failReport = rep([{ id: 'accessibility', level: 'fail', fix: 'requestPermissions' }])

  const mk = (over: Partial<DoctorApi> = {}) => {
    const calls: string[] = []
    const api: DoctorApi = {
      run: vi.fn(async () => {
        calls.push('run')
        return okReport
      }),
      requestPermissions: vi.fn(async () => {
        calls.push('requestPermissions')
      }),
      installCraft: vi.fn(async () => {
        calls.push('installCraft')
        return { kind: 'installed' as const }
      }),
      ...over
    }
    return { api, calls, ctl: doctorController(api) }
  }

  it('«Dar permisos» llama a computer:requestPermissions y luego revisa de nuevo', async () => {
    const m = mk()
    const r = await m.ctl.grantPermissions()
    expect(m.calls).toEqual(['requestPermissions', 'run'])
    expect(r).toEqual(okReport)
    expect(m.api.requestPermissions).toHaveBeenCalledTimes(1)
  })

  it('si pedir permisos falla, no revisa de nuevo y el error sale hacia la tarjeta', async () => {
    const m = mk({ requestPermissions: vi.fn(async () => Promise.reject(new Error('IPC'))) })
    await expect(m.ctl.grantPermissions()).rejects.toThrow('IPC')
    expect(m.api.run).not.toHaveBeenCalled()
  })

  it('«Instalar» (ArtCraft) reutiliza la instalación (consentimiento incluido) y luego revisa', async () => {
    const m = mk()
    await m.ctl.installCraft()
    expect(m.calls).toEqual(['installCraft', 'run'])
  })

  it('xcodeSelect copia exactamente el comando (sin ejecutar nada)', async () => {
    const write = vi.fn(async (_text: string) => undefined)
    await copyXcodeCommand(write)
    expect(write).toHaveBeenCalledWith('xcode-select --install')
    expect(XCODE_COMMAND).toBe('xcode-select --install')
  })

  it('revisar (run) devuelve el informe de doctor:run', async () => {
    const m = mk({ run: vi.fn(async () => failReport) })
    expect(await m.ctl.run()).toEqual(failReport)
  })
})
