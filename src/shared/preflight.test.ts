import { describe, expect, it } from 'vitest'
import {
  SANDBOX_APPROX_BYTES,
  blocking,
  canContinue,
  canInstall,
  dismissalFor,
  diskEnough,
  downloadBytes,
  installPlan,
  optionalPending,
  ordered,
  parseDismissal,
  reportLines,
  requiredFreeBytes,
  rowState,
  shouldShow,
  visibleRows,
  type PreflightComponent,
  type PreflightReport
} from './preflight'

const c = (id: PreflightComponent['id'], o: Partial<PreflightComponent> = {}): PreflightComponent => ({
  id,
  essential: ['storage', 'engine'].includes(id),
  ok: true,
  installable: id === 'craft' || id === 'runtimes' || id === 'sandbox',
  ...o
})
const report = (components: PreflightComponent[], o: Partial<PreflightReport> = {}): PreflightReport => ({
  at: 1,
  platform: 'darwin',
  appVersion: '0.5.12',
  freeBytes: 50e9,
  components,
  ...o
})
const allReady = (): PreflightComponent[] => [c('storage'), c('disk'), c('engine'), c('craft'), c('helper'), c('perms'), c('location')]

describe('qué es esencial y qué no', () => {
  it('con todo listo no hay bloqueos ni pendientes', () => {
    const r = report(allReady())
    expect(blocking(r)).toEqual([])
    expect(optionalPending(r)).toEqual([])
    expect(shouldShow(r, null)).toBeNull()
  })
  it('solo falta el motor: bloquea; faltar ArtCraft, permisos, ubicación o ayudante: solo pendiente', () => {
    const r = report([
      c('storage'),
      c('engine', { ok: false, reason: 'not-found' }),
      c('craft', { ok: false, sizeBytes: 300e6 }),
      c('helper', { ok: false }),
      c('perms', { ok: false, essential: false, reason: 'both' }),
      c('location', { ok: false, essential: false, reason: 'translocated' })
    ])
    expect(blocking(r).map((x) => x.id)).toEqual(['engine'])
    expect(optionalPending(r).map((x) => x.id)).toEqual(['craft', 'helper', 'perms', 'location'])
    expect(shouldShow(r, null)).toBe('blocking')
  })
  it('en Windows el entorno aislado que falta es opcional (solo lo usa Tareas)', () => {
    const r = report([c('storage'), c('engine'), c('craft'), c('sandbox', { ok: false, sizeBytes: SANDBOX_APPROX_BYTES })], {
      platform: 'win32'
    })
    expect(blocking(r)).toEqual([])
    expect(optionalPending(r).map((x) => x.id)).toEqual(['sandbox'])
    expect(shouldShow(r, null)).toBe('optional')
  })
  it('ordena según PREFLIGHT_ORDER sin importar el orden de entrada', () => {
    const r = report([c('perms'), c('craft'), c('engine'), c('storage')])
    expect(ordered(r).map((x) => x.id)).toEqual(['storage', 'engine', 'craft', 'perms'])
  })
})

describe('Node.js y uv en la preparación (F8-B195)', () => {
  it('forman parte de «Preparar todo»: entre ArtCraft y el entorno aislado', () => {
    const r = report([
      c('sandbox', { ok: false, sizeBytes: 2e9 }),
      c('runtimes', { ok: false, sizeBytes: 67e6 }),
      c('craft', { ok: false, sizeBytes: 300e6 })
    ])
    expect(installPlan(r).map((x) => x.id)).toEqual(['craft', 'runtimes', 'sandbox'])
    expect(downloadBytes(r)).toBe(2.367e9)
    expect(requiredFreeBytes(r)).toBe(300e6 * 4 + 67e6 * 6 + 2e9)
  })
  it('NO bloquean: son opcionales, se pueden dejar para más tarde y no impiden continuar', () => {
    const r = report([c('storage'), c('engine'), c('runtimes', { ok: false, sizeBytes: 67e6, reason: 'missing' })])
    expect(blocking(r)).toEqual([])
    expect(optionalPending(r).map((x) => x.id)).toEqual(['runtimes'])
    expect(canContinue(r)).toBe(true)
    expect(shouldShow(r, null)).toBe('optional')
    expect(shouldShow(r, dismissalFor(r))).toBeNull()
  })
  it('si la descarga falla, la fila queda «No se pudo» y el resto de la app sigue disponible', () => {
    const r = report([c('storage'), c('engine'), c('runtimes', { ok: false, sizeBytes: 67e6 })])
    expect(rowState(r.components[2]!, { runtimes: { state: 'failed', error: 'download' } })).toBe('failed')
    expect(canContinue(r, { runtimes: { state: 'failed' } })).toBe(true)
  })
  it('se reintenta: tras fallar sigue en el plan', () => {
    const r = report([c('runtimes', { ok: false, sizeBytes: 67e6 })])
    expect(installPlan(r).map((x) => x.id)).toEqual(['runtimes'])
    expect(canInstall(r)).toBe(true)
  })
})

describe('plan de instalación', () => {
  it('instala en orden ArtCraft y luego el entorno aislado; el motor nunca se instala', () => {
    const r = report([
      c('engine', { ok: false, reason: 'not-found' }),
      c('sandbox', { ok: false, sizeBytes: 2e9 }),
      c('craft', { ok: false, sizeBytes: 300e6 })
    ])
    expect(installPlan(r).map((x) => x.id)).toEqual(['craft', 'sandbox'])
  })
  it('suma lo que se descarga y el espacio que exige (ArtCraft ×4, entorno ×1)', () => {
    const r = report([c('craft', { ok: false, sizeBytes: 300e6 }), c('sandbox', { ok: false, sizeBytes: 2e9 })])
    expect(downloadBytes(r)).toBe(2.3e9)
    expect(requiredFreeBytes(r)).toBe(300e6 * 4 + 2e9)
  })
  it('lo ya listo no entra al plan ni al tamaño', () => {
    const r = report([c('craft'), c('sandbox', { ok: false, sizeBytes: 2e9 })])
    expect(installPlan(r).map((x) => x.id)).toEqual(['sandbox'])
    expect(downloadBytes(r)).toBe(2e9)
  })
  it('un componente no instalable (WSL sin activar) no entra al plan', () => {
    const r = report([c('sandbox', { ok: false, installable: false, reason: 'needsWsl' })])
    expect(installPlan(r)).toEqual([])
    expect(canInstall(r)).toBe(false)
  })
  it('no se puede instalar sin espacio o con la carpeta de datos sin escritura', () => {
    const falta = [c('craft', { ok: false, sizeBytes: 300e6 })]
    expect(canInstall(report(falta))).toBe(true)
    expect(canInstall(report([...falta, c('disk', { ok: false, reason: 'low-space' })]))).toBe(false)
    expect(canInstall(report([...falta, c('storage', { ok: false, reason: 'not-writable' })]))).toBe(false)
  })
  it('diskEnough: sin medida se intenta igual', () => {
    expect(diskEnough(null, 5e9)).toBe(true)
    expect(diskEnough(1e9, 1.2e9)).toBe(false)
    expect(diskEnough(1.2e9, 1.2e9)).toBe(true)
  })
})

describe('estado de cada fila', () => {
  const craft = c('craft', { ok: false })
  it('listo, falta, pendiente (no esencial), descargando y falló', () => {
    expect(rowState(c('engine'))).toBe('ready')
    expect(rowState(craft)).toBe('pending')
    expect(rowState(c('engine', { ok: false }))).toBe('missing')
    expect(rowState(c('perms', { ok: false, essential: false }))).toBe('pending')
    expect(rowState(craft, { craft: { state: 'downloading', pct: 40 } })).toBe('downloading')
    expect(rowState(craft, { craft: { state: 'failed', error: 'disk' } })).toBe('failed')
  })
  it('disco y carpeta de datos solo se muestran si fallan', () => {
    expect(visibleRows(report(allReady())).map((x) => x.id)).toEqual(['engine', 'craft', 'helper', 'perms', 'location'])
    const r = report([c('disk', { ok: false }), c('storage'), c('engine')])
    expect(visibleRows(r).map((x) => x.id)).toEqual(['disk', 'engine'])
  })
  it('se puede continuar solo sin esenciales pendientes ni descargas en curso', () => {
    const faltaMotor = report([c('engine', { ok: false })])
    expect(canContinue(faltaMotor)).toBe(false)
    expect(canContinue(report([c('craft', { ok: false })]))).toBe(true)
    expect(canContinue(report([c('craft'), c('perms', { ok: false, essential: false })]))).toBe(true)
    expect(canContinue(report([c('craft')]), { craft: { state: 'downloading' } })).toBe(false)
  })
})

describe('cuándo mostrar la pantalla', () => {
  const pend = (): PreflightReport => report([c('craft'), c('perms', { ok: false, essential: false, reason: 'both' })])
  it('solo pendientes no esenciales: se muestra hasta «Más tarde» y no vuelve por los mismos pendientes', () => {
    expect(shouldShow(pend(), null)).toBe('optional')
    expect(shouldShow(pend(), dismissalFor(pend()))).toBeNull()
  })
  it('aparece otro pendiente: vuelve a mostrarse; actualizar la app o resolver uno no insiste', () => {
    const d = dismissalFor(pend())
    expect(shouldShow({ ...pend(), appVersion: '0.5.13' }, d)).toBeNull()
    const antes = dismissalFor(report([c('craft', { ok: false }), c('perms', { ok: false, essential: false })]))
    expect(shouldShow(pend(), antes)).toBeNull()
    const otro = report([c('craft'), c('perms', { ok: false, essential: false }), c('location', { ok: false, essential: false })])
    expect(shouldShow(otro, d)).toBe('optional')
  })
  it('lo esencial ignora la huella de «continuar»', () => {
    const r = report([c('engine', { ok: false }), c('perms', { ok: false, essential: false })])
    expect(shouldShow(r, dismissalFor(r))).toBe('blocking')
  })
  it('una revisión omitida (pruebas automáticas) nunca muestra nada', () => {
    expect(shouldShow(report([c('craft', { ok: false })], { skipped: true }), null)).toBeNull()
  })
  it('parseDismissal tolera datos rotos', () => {
    expect(parseDismissal(null)).toBeNull()
    expect(parseDismissal('{no es json')).toBeNull()
    expect(parseDismissal('{"version":3}')).toBeNull()
    expect(parseDismissal('{"version":"1","ids":["perms","raro"]}')).toEqual({ version: '1', ids: ['perms'] })
  })
})

describe('texto del informe', () => {
  it('sin revisión previa lo dice; con revisión lista cada componente', () => {
    expect(reportLines(null)[0]).toContain('sin revisión')
    const lines = reportLines(
      report([c('engine', { version: '1.2.3' }), c('craft', { ok: false, reason: 'incomplete', detail: 'piezas: wordcraft:truncated' })])
    )
    expect(lines.join('\n')).toContain('engine: listo (esencial) — versión 1.2.3')
    expect(lines.join('\n')).toContain('craft: pendiente — motivo incomplete; piezas: wordcraft:truncated')
    expect(lines.at(-1)).toBe('  disco libre: 50000 MB')
  })
})
