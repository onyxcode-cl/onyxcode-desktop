import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PreflightComponent, PreflightReport, RuntimeMap } from '@shared/preflight'
import { PreflightScreen, type PreflightScreenProps } from './PreflightScreen'

const c = (id: PreflightComponent['id'], o: Partial<PreflightComponent> = {}): PreflightComponent => ({
  id,
  essential: ['storage', 'engine'].includes(id),
  ok: true,
  installable: id === 'craft' || id === 'sandbox' || id === 'runtimes',
  ...o
})
const report = (components: PreflightComponent[]): PreflightReport => ({
  at: 1,
  platform: 'darwin',
  appVersion: '0.5.12',
  freeBytes: 50e9,
  components
})
const noop = (): void => undefined
const render = (r: PreflightReport, o: Partial<PreflightScreenProps> & { runtime?: RuntimeMap } = {}): string =>
  renderToStaticMarkup(
    createElement(PreflightScreen, {
      report: r,
      runtime: {},
      installing: false,
      details: {},
      copied: null,
      permsStalled: false,
      permsWaiting: false,
      unchecked: [],
      onToggle: noop,
      onInstall: noop,
      onCopy: noop,
      onContinue: noop,
      onRecheck: noop,
      onGrantPerms: noop,
      onPickEngine: noop,
      ...o
    })
  )

const faltaCraft = (): PreflightComponent[] => [
  c('storage'),
  c('disk'),
  c('engine', { version: '1.2.3' }),
  c('craft', { ok: false, reason: 'missing', sizeBytes: 300e6 })
]

describe('pantalla «Preparando»: falta ArtCraft (opcional)', () => {
  const html = render(report(faltaCraft()))
  it('título, lista de componentes con su estado y el tamaño a descargar', () => {
    expect(html).toContain('Preparando Lazunox')
    expect(html).toMatch(/data-testid="preflight-row-engine" data-state="ready"/)
    expect(html).toMatch(/data-testid="preflight-row-craft" data-state="pending"/)
    expect(html).toContain('Se descargarán unos 300 MB.')
    // Disco y carpeta de datos listos no ocupan fila.
    expect(html).not.toContain('preflight-row-disk')
  })
  it('«Instalar lo que falta» y también «Más tarde»: nada obliga a descargar para entrar', () => {
    expect(html).toContain('Instalar lo que falta')
    expect(html).toContain('Más tarde')
    expect(html).toContain('Opcional')
    expect(html).not.toContain('No se puede omitir')
  })
  it('es un diálogo modal a pantalla completa', () => {
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('fixed inset-0')
  })
})

describe('instalando y fallos', () => {
  it('descargando con porcentaje: el botón queda ocupado y deshabilitado', () => {
    const html = render(report(faltaCraft()), { installing: true, runtime: { craft: { state: 'downloading', pct: 37 } } })
    expect(html).toMatch(/data-testid="preflight-row-craft" data-state="downloading"/)
    expect(html).toContain('37 %')
    expect(html).toContain('Instalando…')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Instalando…/)
  })
  it('falló: muestra el MOTIVO real, «Reintentar» y «Copiar detalle»', () => {
    const html = render(report(faltaCraft()), {
      runtime: { craft: { state: 'failed', error: 'disk' } },
      details: { craft: 'Componente: craft\nMotivo: disk' }
    })
    expect(html).toMatch(/data-testid="preflight-row-craft" data-state="failed"/)
    expect(html).toContain('No hay espacio suficiente')
    expect(html).toContain('Reintentar')
    expect(html).toContain('Copiar detalle')
    expect(html).not.toContain('Instalar lo que falta')
  })
  it('sin detalle todavía no ofrece «Copiar detalle»; con detalle copiado lo confirma', () => {
    const f = { craft: { state: 'failed', error: 'hash' } } as RuntimeMap
    expect(render(report(faltaCraft()), { runtime: f })).not.toContain('Copiar detalle')
    expect(render(report(faltaCraft()), { runtime: f, details: { craft: 'x' }, copied: 'craft' })).toContain('Detalle copiado')
  })
  it('fallo del entorno aislado de Windows con su motivo legible', () => {
    const r = report([c('engine'), c('craft'), c('sandbox', { ok: false, reason: 'needsSetup', sizeBytes: 2e9 })])
    const html = render(r, { runtime: { sandbox: { state: 'failed', error: 'offline' } } })
    expect(html).toContain('No hay conexión con internet.')
    expect(html).toContain('Se descargarán unos 2,0 GB.')
  })
  it('sin espacio en el disco: la fila de disco aparece y no se puede pulsar instalar', () => {
    const r = report([
      c('storage'),
      c('disk', { ok: false, reason: 'low-space' }),
      c('engine'),
      c('craft', { ok: false, sizeBytes: 300e6 })
    ])
    const html = render(r)
    expect(html).toMatch(/data-testid="preflight-row-disk" data-state="pending"/)
    expect(html).toContain('Libera espacio')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Instalar lo que falta/)
  })
  it('motor ausente: ofrece elegir motor manualmente y no hay nada que instalar', () => {
    const r = report([c('storage'), c('disk'), c('engine', { ok: false, reason: 'not-found' }), c('craft')])
    const html = render(r)
    expect(html).toContain('Elegir motor…')
    expect(html).not.toContain('Instalar lo que falta')
    expect(html).toContain('No se puede omitir')
  })
})

describe('avisos no esenciales', () => {
  const optional = (): PreflightReport =>
    report([
      c('storage'),
      c('disk'),
      c('engine'),
      c('craft'),
      c('helper'),
      c('perms', { ok: false, reason: 'both' }),
      c('location', { ok: false, reason: 'translocated' })
    ])
  it('salen como «Pendiente» con su acción y se puede dejar para «Más tarde»', () => {
    const html = render(optional())
    expect(html).toMatch(/data-testid="preflight-row-perms" data-state="pending"/)
    expect(html).toMatch(/data-testid="preflight-row-location" data-state="pending"/)
    expect(html).toContain('Dar permisos')
    expect(html).toContain('Más tarde')
    expect(html).not.toContain('Instalar lo que falta')
    expect(html).not.toContain('No se puede omitir')
  })
  it('reutiliza el aviso de app translocada y el de reinicio por Grabación de pantalla', () => {
    expect(render(optional())).toContain('App Translocation')
    const r = report([c('engine'), c('craft'), c('perms', { ok: false, reason: 'restart' })])
    const html = render(r)
    expect(html).toContain('Falta un reinicio para Grabación de pantalla')
    expect(html).not.toContain('Dar permisos')
  })
  it('permisos que no se activan tras esperar: ayuda de reparación', () => {
    expect(render(optional(), { permsStalled: true })).toContain('Los permisos no se activan')
  })
  it('con lo esencial pendiente (motor) Y avisos, «Más tarde» NO aparece', () => {
    const r = report([c('engine', { ok: false, reason: 'not-found' }), c('craft'), c('perms', { ok: false, reason: 'both' })])
    expect(render(r)).not.toContain('Más tarde')
  })
  it('todo listo (tras instalar): botón «Continuar»', () => {
    const html = render(report([c('storage'), c('disk'), c('engine'), c('craft')]))
    expect(html).toContain('>Continuar<')
  })
})

describe('casillas por componente (F8-B197)', () => {
  const faltaTodo = (): PreflightReport =>
    report([
      c('storage'),
      c('disk'),
      c('engine'),
      c('craft', { ok: false, reason: 'missing', sizeBytes: 205e6 }),
      c('runtimes', { ok: false, reason: 'missing', sizeBytes: 67e6 }),
      c('perms', { ok: false, reason: 'both' })
    ])
  it('cada componente instalable lleva su casilla, marcada, con el tamaño y de dónde se baja', () => {
    const html = render(faltaTodo())
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="pick-craft"[^>]*checked=""/)
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="pick-runtimes"[^>]*checked=""/)
    expect(html).toContain('unos 205 MB')
    expect(html).toContain('GitHub')
    expect(html).toContain('unos 67 MB')
    expect(html).toContain('nodejs.org')
    expect(html).toContain('Se descargarán unos 272 MB.')
  })
  it('lo que no se instala (permisos) no lleva casilla', () => {
    expect(render(faltaTodo())).not.toContain('pick-perms')
  })
  it('la casilla enlaza su texto de ayuda para lectores de pantalla', () => {
    const html = render(faltaTodo())
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(id).toBeTruthy()
    expect(html).toContain(`id="${id}"`)
  })
  it('desmarcada no cuenta: el tamaño baja y el botón sigue activo', () => {
    const html = render(faltaTodo(), { unchecked: ['craft'] })
    expect(html).not.toMatch(/data-testid="pick-craft"[^>]*checked=""/)
    expect(html).toMatch(/data-testid="pick-runtimes"[^>]*checked=""/)
    expect(html).toContain('Se descargarán unos 67 MB.')
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Instalar lo que falta/)
  })
  it('con todo desmarcado no se descarga nada y «Instalar lo que falta» se apaga; «Más tarde» sigue', () => {
    const html = render(faltaTodo(), { unchecked: ['craft', 'runtimes'] })
    expect(html).toContain('No hay nada marcado')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Instalar lo que falta/)
    expect(html).toContain('Más tarde')
  })
  it('durante la instalación las casillas quedan fijas', () => {
    const html = render(faltaTodo(), { installing: true })
    expect(html).toMatch(/<input[^>]*data-testid="pick-craft"[^>]*disabled=""/)
  })
  it('cada fila fallida tiene su propio estado; la otra conserva el suyo', () => {
    const html = render(faltaTodo(), { runtime: { craft: { state: 'failed', error: 'hash' } } })
    expect(html).toMatch(/data-testid="preflight-row-craft" data-state="failed"/)
    expect(html).toMatch(/data-testid="preflight-row-runtimes" data-state="pending"/)
  })
})
