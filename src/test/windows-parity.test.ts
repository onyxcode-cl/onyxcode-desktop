/**
 * Guardia de la tabla de paridad Mac/Windows (`docs/PARIDAD-WINDOWS.json`, plan W10, sección E del plan de paridad).
 *
 * Si alguien cambia `capsFor`, una bandera de producción, un literal de compilación o el catálogo sin actualizar la tabla, esta
 * prueba falla. Para cambiar un estado: edita la fila (estado, evidencia archivo:línea y, si se puede comprobar en ejecución, su
 * `comprobacion`) y el bloque `esperadoCaps`. `scripts/win/parity-check.mjs` (W14) lee el mismo archivo.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { LOCAL_CATALOG } from '@shared/mcp-catalog'
import { AUTO_INSTALL_IDS } from '@shared/preflight'
import { capsFor, type CapsFlags, type PlatformCaps } from '@shared/platform-caps'
import { DICTIONARIES } from '@shared/i18n'
import { sandboxView } from '../renderer/src/features/tasks/impl/sandbox-view'

const ROOT = resolve(__dirname, '../..')
const ESCALA = ['IGUAL', 'DIFERENTE A PROPÓSITO', 'FALTA TRABAJO', 'ROTO', 'NO VERIFICADO']

interface Comprobacion {
  tipo: 'cap' | 'flag' | 'sandbox' | 'catalogo'
  clave?: string
  esperado?: unknown
  backend?: string
  sinAdministrador?: { estadoProhibido?: string }
  conAdministrador?: { state: string; detail: string }
  runtimesOffered?: Record<string, boolean>
}
interface Feature {
  id: string
  funcion: string
  estado: string
  evidencia: string[]
  nota: string
  comprobacion: Comprobacion | null
}
interface Tabla {
  schemaVersion: number
  escala: string[]
  produccion: Record<string, CapsFlags>
  esperadoCaps: Record<string, PlatformCaps>
  esperadoEnEjecucion: {
    win32: {
      platform: string
      capsFlags: CapsFlags
      sandbox: { backend: string; sinAdministrador: { estadosProhibidos: string[] }; conAdministrador: { state: string; detail: string } }
    }
  }
  windowsSkippedBaseline: number | null
  features: Feature[]
}

const tabla = JSON.parse(readFileSync(resolve(ROOT, 'docs/PARIDAD-WINDOWS.json'), 'utf8')) as Tabla

describe('tabla de paridad: forma', () => {
  it('la escala es la exacta y todo estado pertenece a ella', () => {
    expect(tabla.escala).toEqual(ESCALA)
    for (const f of tabla.features) expect(ESCALA, `${f.id}: estado «${f.estado}»`).toContain(f.estado)
  })
  it('los ids son únicos y tienen formato P## o N##', () => {
    const ids = tabla.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[PN]\d{2}$/)
  })
  it('cubre todo el inventario P01 a P67', () => {
    for (let n = 1; n <= 67; n++)
      expect(
        tabla.features.some((f) => f.id === `P${String(n).padStart(2, '0')}`),
        `P${n}`
      ).toBe(true)
  })
  it('cada fila trae función, nota y evidencia archivo:línea que existe', () => {
    for (const f of tabla.features) {
      expect(f.funcion.length, f.id).toBeGreaterThan(0)
      expect(f.evidencia.length, `${f.id}: sin evidencia`).toBeGreaterThan(0)
      for (const ev of f.evidencia) {
        const m = /^(.+):(\d+)$/.exec(ev)
        expect(m, `${f.id}: «${ev}» no es archivo:línea`).not.toBeNull()
        const file = resolve(ROOT, m![1])
        expect(existsSync(file), `${f.id}: no existe ${m![1]}`).toBe(true)
        const lines = readFileSync(file, 'utf8').split('\n').length
        expect(Number(m![2]), `${f.id}: ${ev} fuera del archivo (${lines} líneas)`).toBeGreaterThanOrEqual(1)
        expect(Number(m![2]), `${f.id}: ${ev} fuera del archivo (${lines} líneas)`).toBeLessThanOrEqual(lines)
      }
    }
  })
  it('la línea base de pruebas saltadas es null o un entero no negativo', () => {
    const b = tabla.windowsSkippedBaseline
    expect(b === null || (Number.isInteger(b) && b >= 0)).toBe(true)
  })
})

describe('tabla de paridad: capacidades', () => {
  it('capsFor(win32, banderas de producción) es exactamente lo que dice la tabla', () => {
    expect(capsFor('win32', tabla.produccion.win32)).toEqual(tabla.esperadoCaps.win32)
  })
  it('capsFor(darwin) es exactamente lo que dice la tabla', () => {
    expect(capsFor('darwin', tabla.produccion.darwin)).toEqual(tabla.esperadoCaps.darwin)
  })
  it('cada comprobación cap/flag de una fila coincide con capsFor y con las banderas', () => {
    const caps = capsFor('win32', tabla.produccion.win32)
    for (const f of tabla.features) {
      const c = f.comprobacion
      if (!c || (c.tipo !== 'cap' && c.tipo !== 'flag')) continue
      if (c.tipo === 'cap') expect((caps as unknown as Record<string, unknown>)[c.clave!], `${f.id}: cap ${c.clave}`).toEqual(c.esperado)
      else expect((tabla.produccion.win32 as Record<string, unknown>)[c.clave!], `${f.id}: bandera ${c.clave}`).toEqual(c.esperado)
    }
  })
  it('las banderas de producción de win32 salen de los literales de compilación reales', () => {
    // `src/test` se compila con el proyecto web: no puede importar `src/main`, así que se leen los literales del código.
    const src = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')
    const p = tabla.produccion.win32
    expect(TASKS_WIN_BUILD).toBe(p.tasksWin)
    expect(src('src/main/remote/remote-win-flag.ts')).toMatch(/export const REMOTE_WIN_BUILD = true\b/)
    expect(p.remoteWin).toBe(true)
    // `computerWin` = tasksWin && cu-helper.exe presente (computer-win-flag.ts); el paquete de Windows lo lleva con TASKS_WIN_BUILD.
    expect(src('src/main/computer/computer-win-flag.ts')).toContain('deps.helperPresent === true')
    expect(src('electron-builder.js')).toContain('const computerWinPack = tasksWinBuildOn')
    expect(p.computerWin).toBe(true)
    // `pythonWin` lo enciende main si el Python incluido existe en el paquete (W11).
    expect(src('src/main/index.ts')).toContain('pythonWinOn = bundledPythonPresent()')
    expect(p.pythonWin).toBe(true)
  })
  it('lo esperado en ejecución es coherente con la tabla', () => {
    const e = tabla.esperadoEnEjecucion.win32
    expect(e.platform).toBe('win32')
    expect(e.capsFlags).toEqual(tabla.produccion.win32)
    expect(e.sandbox.backend).toBe(tabla.esperadoCaps.win32.tasksSandbox)
  })
  it('sin Overdrive no hay modo Tareas y sin pythonWin no se traduce (la tabla depende de las banderas)', () => {
    expect(capsFor('win32', {}).tasks).toBe(false)
    expect(capsFor('win32', {}).docViewer).toBe(true)
    expect(capsFor('win32', { tasksWin: false }).docViewer).toBe(true)
    expect(capsFor('win32', { tasksWin: true }).translatePdf).toBe(false)
    expect(capsFor('win32', { tasksWin: true, pythonWin: true }).translatePdf).toBe(true)
  })
})

describe('tabla de paridad: Overdrive y administrador', () => {
  const e = (): Tabla['esperadoEnEjecucion']['win32']['sandbox'] => tabla.esperadoEnEjecucion.win32.sandbox
  it('con administrador la interfaz muestra el aviso y no ofrece botones', () => {
    const v = sandboxView(
      { backend: 'wsl', state: e().conAdministrador.state as 'unsupported', detail: e().conAdministrador.detail, setup: null },
      'wsl'
    )
    expect(v.title).toBe('tasks.sandbox.elevated.title')
    expect(v.actions).toEqual([])
    expect(v.blocksStart).toBe(true)
    expect(DICTIONARIES.es['tasks.sandbox.elevated.title']).toBeDefined()
  })
  it('unsupported sin el detalle de administrador sigue siendo «puerta cerrada», no el aviso de administrador', () => {
    const v = sandboxView({ backend: 'wsl', state: 'unsupported', detail: 'gate', setup: null }, 'wsl')
    expect(v.title).not.toBe('tasks.sandbox.elevated.title')
    expect(e().sinAdministrador.estadosProhibidos).toContain('unsupported')
  })
})

describe('tabla de paridad: instalación automática y catálogo', () => {
  const offered = (plat: string): boolean => LOCAL_CATALOG.some((i) => i.runtime.platforms.includes(plat))
  it('ArtCraft, Node.js/uv y el entorno aislado están en la instalación automática', () => {
    expect([...AUTO_INSTALL_IDS].sort()).toEqual(['craft', 'runtimes', 'sandbox'])
  })
  it('los pines traen Windows x64 para ArtCraft, Node.js, uv y Python', () => {
    const pin = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8')
    expect(pin('resources/craft/pin.json')).toContain('"win32-x64"')
    expect(pin('resources/runtimes/pin.json')).toContain('"win32-x64"')
    expect(pin('resources/python-bin/pin.json')).toContain('"win32-x64"')
  })
  it('lo que la tabla dice de runtimesOffered coincide con el catálogo real', () => {
    for (const f of tabla.features) {
      if (f.comprobacion?.tipo !== 'catalogo') continue
      for (const [plat, v] of Object.entries(f.comprobacion.runtimesOffered ?? {})) expect(offered(plat), `${f.id}: ${plat}`).toBe(v)
    }
  })
})

describe('i18n: variantes .win', () => {
  it('cada clave .win tiene su base en es y en en', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const key of Object.keys(DICTIONARIES[lang]).filter((k) => k.endsWith('.win'))) {
        const base = key.slice(0, -4)
        expect(DICTIONARIES[lang][base], `${lang}: falta la base de ${key}`).toBeDefined()
        expect(DICTIONARIES.es[base], `es: falta la base de ${key}`).toBeDefined()
      }
    }
  })
})
