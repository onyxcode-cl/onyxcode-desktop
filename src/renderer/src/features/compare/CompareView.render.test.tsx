/** Render estático (sin DOM): estados de la píldora, métricas «—», cuenta atrás, accesibilidad y el celular sin la función. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CompareColumnManifest, CompareManifest } from '@shared/ipc-code'
import { assistantMessage, textPart, toolPart } from '../../../../test/fixtures/events'
import { CompareColumn } from './CompareColumn'
import { ConfirmDialogBody, CompareConfirmDialog } from './CompareConfirmDialog'
import { ArmedChip, CompareControls } from './CompareControls'
import { CompareViewContent } from './CompareView'
import { DiffDrawer } from './DiffDrawer'
import { RecoveryBanner } from './RecoveryBanner'
import { columnBadges } from './model'
import { fakeCompare, installApi, mkCol, mkManifest, NO_METRICS } from './testkit'
import type { ConfirmRequest } from './store'
import type { MessageEntry } from '../../lib/session-reducer'
import { stripDesk } from '../../../../test/strip-desk'

const noop = (): void => undefined
const NOW = 100_000

const col = (
  c: CompareColumnManifest,
  over: { m?: CompareManifest; entries?: MessageEntry[]; mode?: 'code' | 'chat'; now?: number } = {}
): string =>
  renderToStaticMarkup(
    <CompareColumn
      manifest={over.m ?? mkManifest({}, [c])}
      column={c}
      modelName={`Modelo ${c.index}`}
      entries={over.entries ?? []}
      now={over.now ?? NOW}
      badges={[]}
      permissions={[]}
      mode={over.mode ?? 'code'}
      busy={undefined}
      failure={undefined}
      onKeep={noop}
      onDiscard={noop}
      onCancel={noop}
      onRetry={noop}
      onViewDiff={noop}
      onReply={noop}
    />
  )

beforeEach(() => installApi(fakeCompare().api))
afterEach(() => installApi(null))

describe('CompareColumn: píldora de estado', () => {
  it.each([
    ['queued', 'En cola'],
    ['starting', 'Arrancando'],
    ['running', 'Trabajando'],
    ['done', 'Listo'],
    ['error', 'Error'],
    ['rateLimited', 'Límite de uso'],
    ['cancelled', 'Cancelado']
  ] as const)('%s → «%s» con aria-live educado', (state, label) => {
    const html = col(
      mkCol(0, {
        state,
        retryAt: state === 'rateLimited' ? NOW + 20_000 : null,
        error: state === 'error' ? { kind: 'unknown', message: 'se rompió' } : null
      })
    )
    expect(html).toContain(`data-state="${state}"`)
    expect(html).toContain(label)
    expect(html).toContain('role="status" aria-live="polite"')
  })
  it('elegida, interrumpida y descartada', () => {
    expect(col(mkCol(0, { state: 'done', adopted: true }))).toContain('Elegido')
    expect(col(mkCol(0, { state: 'done', adopted: true }))).toContain('ring-2 ring-accent ring-inset')
    const interrupted = col(mkCol(0, { state: 'running', interrupted: true }))
    expect(interrupted).toContain('Interrumpido')
    expect(interrupted).toContain('La aplicación se cerró')
    const discarded = col(mkCol(0, { state: 'done', discarded: true }))
    expect(discarded).toContain('Descartado')
    expect(discarded).toContain('Esta versión se descartó.')
    expect(discarded).not.toContain('Quedarme con este')
  })
  it('región accesible con el nombre del modelo y cuerpo desplazable por teclado', () => {
    const html = col(mkCol(0, { state: 'running' }))
    expect(html).toContain('role="region" aria-label="Modelo 0"')
    expect(html).toContain('role="log"')
    expect(html).toContain('tabindex="0"')
  })
})

describe('CompareColumn: métricas', () => {
  it('con todo null se pintan «—» y jamás «$0»', () => {
    const html = col(mkCol(0, { state: 'done', metrics: { ...NO_METRICS } }))
    expect(html).toContain('data-testid="compare-cost-0"')
    expect(html).toMatch(/data-testid="compare-cost-0"[^>]*>.*?Coste <\/span>sin dato</) // F8-B98: el coste sin dato se rotula «sin dato», ya no «—»
    expect(html).not.toMatch(/\$\s?0([^,.\d]|$)/)
    expect(html).not.toContain('US$0')
    expect(html).toContain('El proveedor no informó el coste')
  })
  it('un coste en 0 que llegase al renderer tampoco se pinta como $0', () => {
    const html = col(mkCol(0, { state: 'done', metrics: { ...NO_METRICS, costUsd: 0, inputTokens: 0 } }))
    expect(html).not.toMatch(/\$\s?0([^,.\d]|$)/)
    expect(html).toMatch(/Coste <\/span>sin dato</)
  })
  it('con datos: tokens, coste y duración', () => {
    const html = col(
      mkCol(0, {
        state: 'done',
        metrics: { ...NO_METRICS, inputTokens: 12_400, outputTokens: 3_100, costUsd: 0.01, llmCalls: 3, durationMs: 48_000 }
      })
    )
    expect(html).toContain('12,4')
    expect(html).toContain('3,1')
    expect(html).toMatch(/0,01/)
    expect(html).toContain('48 s')
    expect(html).toContain('Llamadas: 3')
  })
  it('las insignias salen con ≥2 columnas hechas', () => {
    const a = mkCol(0, { state: 'done', metrics: { ...NO_METRICS, costUsd: 0.5, durationMs: 9000 } })
    const b = mkCol(1, { state: 'done', metrics: { ...NO_METRICS, costUsd: 0.1, durationMs: 30000 } })
    expect([...columnBadges([a, b]).entries()]).toEqual([
      [1, ['cheapest']],
      [0, ['fastest']]
    ])
    const html = renderToStaticMarkup(
      <CompareColumn
        manifest={mkManifest({}, [a, b])}
        column={b}
        modelName="B"
        entries={[]}
        now={NOW}
        badges={['cheapest']}
        permissions={[]}
        mode="code"
        busy={undefined}
        failure={undefined}
        onKeep={noop}
        onDiscard={noop}
        onCancel={noop}
        onRetry={noop}
        onViewDiff={noop}
        onReply={noop}
      />
    )
    expect(html).toContain('más barato')
  })
})

describe('CompareColumn: límite de uso y cuenta atrás', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('reintento programado: cuenta atrás que baja con el reloj y sin botón', () => {
    const c = mkCol(2, { state: 'rateLimited', retryAt: NOW + 20_000 })
    const m = mkManifest({}, [c])
    expect(col(c, { m, now: Date.now() })).toContain('Reintento en 20 s')
    vi.setSystemTime(NOW + 5_000)
    const later = col(c, { m, now: Date.now() })
    expect(later).toContain('Reintento en 15 s')
    expect(later).not.toContain('Reintentar')
    vi.setSystemTime(NOW + 21_000)
    expect(col(c, { m, now: Date.now() })).toContain('Reintentando…')
  })
  it('agotado (retryAt null): en pausa, con botón «Reintentar» accesible', () => {
    const c = mkCol(2, { state: 'rateLimited', retryAt: null, retried: true })
    const html = col(c, { m: mkManifest({}, [c]) })
    expect(html).toContain('En pausa por límite de uso')
    expect(html).toContain('aria-label="Reintentar Modelo 2"')
  })
  it('una columna en cola de un proveedor en pausa también ofrece reintentar', () => {
    const c = mkCol(3, { state: 'queued', model: { providerID: 'opencode-go', modelID: 'x' } })
    const html = col(c, { m: mkManifest({ pausedProviders: ['opencode-go'] }, [c]) })
    expect(html).toContain('En pausa por límite de uso')
    expect(html).toContain('Reintentar')
  })
  it('parada sin confirmar: avisa, conserva la copia y no deja descartar', () => {
    const html = col(mkCol(0, { state: 'cancelled', stopUnconfirmed: true }))
    expect(html).toContain('El motor no confirmó la parada; la copia se conserva.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Descartar Modelo 0"/)
  })
})

describe('CompareColumn: acciones', () => {
  it('Code hecha con diff: resumen, «Ver cambios», «Quedarme con este» y «Descartar»', () => {
    const html = col(mkCol(0, { state: 'done', diff: { files: 4, additions: 12, deletions: 3 } }))
    expect(html).toContain('+12')
    expect(html).toContain('−3')
    expect(html).toContain('4 archivos')
    expect(html).toContain('Ver cambios')
    expect(html).toContain('Quedarme con este')
    expect(html).toContain('aria-label="Quedarme con Modelo 0"')
    expect(html).toContain('Descartar')
  })
  it('Chat: «Seguir con este» y sin diff', () => {
    const html = col(mkCol(0, { state: 'done', worktree: null }), { mode: 'chat' })
    expect(html).toContain('Seguir con este')
    expect(html).not.toContain('Ver cambios')
  })
  it('en curso: «Cancelar» y nada de «Quedarme»', () => {
    const html = col(mkCol(0, { state: 'running' }))
    expect(html).toContain('Cancelar')
    expect(html).not.toContain('Quedarme con este')
    expect(html).not.toContain('>Descartar<')
  })
  it('fallo al adoptar: conflicto con «Abrir la copia» y «Copiar el parche»', () => {
    const c = mkCol(0, { state: 'done' })
    const html = renderToStaticMarkup(
      <CompareColumn
        manifest={mkManifest({}, [c])}
        column={c}
        modelName="M"
        entries={[]}
        now={NOW}
        badges={[]}
        permissions={[]}
        mode="code"
        busy={undefined}
        failure={{ reason: 'conflict', files: ['a.txt'] }}
        onKeep={noop}
        onDiscard={noop}
        onCancel={noop}
        onRetry={noop}
        onViewDiff={noop}
        onReply={noop}
        onOpenWorktree={noop}
        onCopyPatch={noop}
      />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('Estos cambios chocan con tu proyecto. No se ha tocado nada.')
    expect(html).toContain('Abrir la copia para resolverlo')
    expect(html).toContain('Copiar el parche')
  })
  it('conversación en vivo: texto Markdown del asistente y herramientas en una línea; ignora lo sintético', () => {
    const info = assistantMessage('m1', 'ses_0')
    const entries: MessageEntry[] = [
      {
        info,
        parts: [
          textPart('p1', 'm1', 'ses_0', 'Voy a **editar** el archivo'),
          textPart('p2', 'm1', 'ses_0', 'oculto', { synthetic: true }),
          toolPart('p3', 'm1', 'ses_0', 'edit', {
            status: 'completed',
            title: 'src/a.ts',
            input: {},
            output: '',
            time: { start: 1, end: 2 }
          })
        ]
      }
    ]
    const html = col(mkCol(0, { state: 'running' }), { entries })
    expect(html).toContain('<strong>editar</strong>')
    expect(html).toContain('src/a.ts')
    expect(html).not.toContain('oculto')
  })
})

describe('CompareViewContent', () => {
  const content = (m: CompareManifest, extra: Partial<Parameters<typeof CompareViewContent>[0]> = {}): string =>
    renderToStaticMarkup(
      <CompareViewContent
        manifest={m}
        messages={{}}
        busy={{}}
        failures={{}}
        diffs={{}}
        error={undefined}
        permissions={[]}
        providers={[{ id: 'fake', models: { 'model-0': { name: 'Modelo Cero' } } }]}
        now={NOW}
        {...extra}
      />
    )
  it('cabecera, rejilla con columnas de mín. 300 px desplazable y acciones generales', () => {
    const html = content(mkManifest({}, [mkCol(0), mkCol(1), mkCol(2), mkCol(3)]))
    expect(html).toContain('Comparación')
    expect(html).toContain('4 modelos')
    expect(html).toContain('haz que el botón sea azul')
    expect(html).toContain('auto-cols-[minmax(300px,1fr)]')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('role="group" aria-label="Columnas de la comparación"')
    expect((html.match(/role="region"/g) ?? []).length).toBe(4)
    expect(html).toContain('Modelo Cero')
    expect(html).toContain('Cancelar todo')
    expect(html).not.toContain('Guardar en el banco')
  })
  it('terminada: «Guardar en el banco» con su ayuda y sin «Cancelar todo»', () => {
    const html = content(mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'error' })]))
    expect(html).toContain('Guardar en el banco')
    expect(html).toContain('Exporta un archivo para el banco de pruebas de agentes')
    expect(html).not.toContain('Cancelar todo')
  })
  it('1 modelo usa el singular; error de acción en un aviso', () => {
    const html = content(mkManifest({}, [mkCol(0)]), { error: 'No se pudo descartar' })
    expect(html).toContain('1 modelo')
    expect(html).toContain('role="alert"')
    expect(html).toContain('No se pudo descartar')
  })
  it('un permiso pendiente aparece dentro de su columna', () => {
    const html = content(mkManifest({}, [mkCol(0), mkCol(1)]), {
      permissions: [
        {
          id: 'p1',
          sessionID: 'ses_1',
          permission: 'bash',
          patterns: ['ls *'],
          metadata: {},
          always: [],
          api: 'v1',
          index: 1,
          compareId: mkManifest().id
        }
      ]
    })
    expect(html).toContain('Espera tu permiso')
    expect(html).toContain('Permitir una vez')
    expect((html.match(/Permitir una vez/g) ?? []).length).toBe(1)
  })
  it('nada de «$0» en ninguna columna con métricas desconocidas', () => {
    const html = content(mkManifest({}, [mkCol(0, { state: 'done' }), mkCol(1, { state: 'done' })]))
    expect(html).not.toMatch(/\$\s?0([^,.\d]|$)/)
  })
  it('caracterización: el marcado (sin desk:) queda estable en la superficie remota', () => {
    installApi(fakeCompare().api, 'remote')
    const html = content(
      mkManifest({}, [
        mkCol(0, { state: 'done', diff: { files: 1, additions: 2, deletions: 1 } }),
        mkCol(1, { state: 'error', error: { kind: 'unknown', message: 'falló' } })
      ])
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<div class="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="compare-view"><header class="drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-3"><h2 class="shrink-0 font-display text-[14px] font-semibold">Comparación</h2><span class="shrink-0 text-[12px] text-subtle">2 modelos</span><span class="min-w-0 flex-1 truncate text-[12.5px] text-subtle" title="haz que el botón sea azul">haz que el botón sea azul</span><div class="no-drag flex shrink-0 items-center gap-1.5"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-2.5 py-1 text-[13px] gap-1.5 text-muted hover:bg-hover hover:text-fg " title="Exporta un archivo para el banco de pruebas de agentes">Guardar en el banco</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-2.5 py-1 text-[13px] gap-1.5 text-muted hover:bg-hover hover:text-fg ">Cerrar</button></div></header><div role="group" aria-label="Columnas de la comparación" tabindex="0" class="grid min-h-0 flex-1 auto-cols-[minmax(300px,1fr)] grid-flow-col divide-x divide-border overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"><section role="region" aria-label="Modelo Cero" data-testid="compare-col-0" data-state="done" class="relative flex min-h-0 min-w-0 flex-col bg-bg  "><header class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"><h3 class="min-w-0 flex-1 truncate text-[13px] font-medium" title="Modelo Cero">Modelo Cero</h3><span role="status" aria-live="polite" data-state="done" class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium bg-inset text-success">Listo</span></header><div role="group" aria-label="Métricas de Modelo Cero" title="Entrada: — · Salida: — · Razonamiento: — · Caché: — · Llamadas: 0" class="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11.5px] text-muted tabular-nums"><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Entrada"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg><span class="sr-only">Entrada </span>—</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Salida"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-left" aria-hidden="true"><path d="M17 7 7 17"></path><path d="M17 17H7V7"></path></svg><span class="sr-only">Salida </span>—</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="El proveedor no informó el coste" data-testid="compare-cost-0"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"></path><path d="M15 6h1v4"></path><path d="m6.134 14.768.866-.5 2 3.464"></path><circle cx="16" cy="8" r="6"></circle></svg><span class="sr-only">Coste </span>sin dato</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Duración"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-timer" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle></svg><span class="sr-only">Duración </span>—</span></div><div role="log" aria-live="off" aria-label="Modelo Cero" tabindex="0" class="min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"><p class="text-[12.5px] text-subtle"></p></div><footer class="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3"><span class="min-w-0 truncate text-[11.5px] text-muted tabular-nums"><span class="text-success">+2</span> <span class="text-danger">−1</span> · 1 archivo</span><button type="button" class="shrink-0 rounded text-[12px] font-medium text-accent underline-offset-2 hover:underline">Ver cambios</button><span class="ml-auto"></span><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-2.5 py-1 text-[13px] gap-1.5 text-muted hover:bg-hover hover:text-fg " aria-label="Descartar Modelo Cero">Descartar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-2.5 py-1 text-[13px] gap-1.5 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong " aria-label="Quedarme con Modelo Cero">Quedarme con este</button></footer></section><section role="region" aria-label="model-1" data-testid="compare-col-1" data-state="error" class="relative flex min-h-0 min-w-0 flex-col bg-bg  "><header class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"><h3 class="min-w-0 flex-1 truncate text-[13px] font-medium" title="model-1">model-1</h3><span role="status" aria-live="polite" data-state="error" class="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium bg-inset text-danger">Error</span></header><div role="group" aria-label="Métricas de model-1" title="Entrada: — · Salida: — · Razonamiento: — · Caché: — · Llamadas: 0" class="flex min-h-9 shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11.5px] text-muted tabular-nums"><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Entrada"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg><span class="sr-only">Entrada </span>—</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Salida"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-left" aria-hidden="true"><path d="M17 7 7 17"></path><path d="M17 17H7V7"></path></svg><span class="sr-only">Salida </span>—</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="El proveedor no informó el coste" data-testid="compare-cost-1"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coins" aria-hidden="true"><path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"></path><path d="M15 6h1v4"></path><path d="m6.134 14.768.866-.5 2 3.464"></path><circle cx="16" cy="8" r="6"></circle></svg><span class="sr-only">Coste </span>sin dato</span><span class="inline-flex h-[22px] items-center gap-1 rounded-md bg-inset px-1.5 text-[11.5px] tabular-nums text-muted" title="Duración"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-timer" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"></line><line x1="12" x2="15" y1="14" y2="11"></line><circle cx="12" cy="14" r="8"></circle></svg><span class="sr-only">Duración </span>—</span></div><p role="alert" class="shrink-0 border-b border-border bg-inset px-3 py-1.5 text-[12px] text-danger">falló</p><div role="log" aria-live="off" aria-label="model-1" tabindex="0" class="min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"><p class="text-[12.5px] text-subtle"></p></div><footer class="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3"><span class="ml-auto"></span><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-2.5 py-1 text-[13px] gap-1.5 text-muted hover:bg-hover hover:text-fg " aria-label="Descartar model-1">Descartar</button></footer></section></div></div>"`
    )
  })
})

describe('DiffDrawer', () => {
  it('diálogo con título, botón de cierre y diff; estados de carga y error', () => {
    const ready = renderToStaticMarkup(
      <DiffDrawer
        title="Cambios de Modelo"
        state={{
          status: 'ready',
          diff: {
            files: 1,
            additions: 1,
            deletions: 0,
            patch: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+hola\n',
            truncated: true
          }
        }}
        onClose={noop}
      />
    )
    expect(ready).toContain('role="dialog" aria-label="Cambios de Modelo"')
    expect(ready).toContain('aria-label="Cerrar los cambios"')
    expect(ready).toContain('w-[560px] max-w-[90vw]')
    expect(ready).toContain('El parche es muy grande')
    expect(renderToStaticMarkup(<DiffDrawer title="x" state={{ status: 'loading' }} onClose={noop} />)).toContain('Calculando los cambios…')
    expect(renderToStaticMarkup(<DiffDrawer title="x" state={{ status: 'error', message: 'falló' }} onClose={noop} />)).toContain('falló')
  })
})

const confirmReq = (over: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  id: 'x',
  mode: 'code',
  directory: '/repo',
  text: 'haz el botón azul',
  permissionMode: 'manual',
  models: [
    { providerID: 'fake', modelID: 'a' },
    { providerID: 'opencode-go', modelID: 'b' },
    { providerID: 'fake', modelID: 'c' }
  ],
  blocker: null,
  preflight: { repo: true, root: '/repo', head: 'abc1234ef', shortHead: 'abc1234', clean: false, dirtyFiles: 2 },
  checking: false,
  spent: 1.5,
  starting: false,
  error: null,
  ...over
})
const body = (c: ConfirmRequest): string =>
  renderToStaticMarkup(<ConfirmDialogBody c={c} nameOf={(_p, m) => `M-${m}`} dontAsk={false} onDontAsk={noop} />)

describe('diálogo previo', () => {
  it('avisa del ×N, de los límites, del commit de partida y de las dependencias; es modal y accesible', () => {
    const html = body(confirmReq())
    expect(html).toContain('role="dialog" aria-modal="true"')
    expect(html).toContain('aria-labelledby="compare-confirm-title"')
    expect(html).toContain('Se ejecutará 3 veces: el uso se multiplica ×3.')
    expect(html).toContain('Hoy llevas')
    expect(html).toContain('limitan el uso por minuto')
    expect(html).toContain('parte del último commit (abc1234)')
    expect(html).toContain('sin dependencias instaladas')
    expect(html).toContain('No volver a mostrar')
    expect(html).toContain('>Comparar<')
    expect(html).not.toContain('OpenCode')
  })
  it('sin gasto conocido no inventa cifras; árbol limpio no avisa de cambios', () => {
    const html = body(
      confirmReq({ spent: null, preflight: { repo: true, root: '/r', head: 'a', shortHead: 'a', clean: true, dirtyFiles: 0 } })
    )
    expect(html).toContain('Se ejecutará 3 veces: el uso se multiplica ×3.')
    expect(html).not.toContain('Hoy llevas')
    expect(html).not.toContain('Los cambios sin confirmar no entran')
  })
  it('bloqueado: explica el motivo, sin botón de lanzar ni casilla', () => {
    for (const [blocker, text] of [
      ['noRepo', 'Comparar en Code necesita un repositorio git. Puedes comparar en Chat.'],
      ['attachments', 'no admite adjuntos todavía'],
      ['busy', 'Ya hay una comparación en curso.']
    ] as const) {
      const html = body(confirmReq({ blocker }))
      expect(html).toContain(text)
      expect(html).toContain('role="alert"')
      expect(html).not.toContain('>Comparar<')
      expect(html).not.toContain('No volver a mostrar')
    }
  })
  it('error de main visible y botón de lanzar desactivado mientras comprueba', () => {
    const html = body(confirmReq({ checking: true, error: 'Ya hay una comparación en curso.', preflight: null }))
    expect(html).toContain('Comprobando el proyecto…')
    expect(html).toContain('Ya hay una comparación en curso.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Comparar</)
  })
  it('el contenedor no pinta nada si no hay petición (store inicial)', () => {
    expect(renderToStaticMarkup(<CompareConfirmDialog mode="code" directory="/repo" />)).toBe('')
  })
})

describe('chip y botón del compositor', () => {
  it('chip «Comparar ×3» con su ✕ accesible', () => {
    const html = renderToStaticMarkup(<ArmedChip count={3} onRemove={noop} />)
    expect(html).toContain('Comparar ×3')
    expect(html).toContain('aria-label="Quitar la comparación"')
    expect(html).toContain('bg-accent-soft')
  })
  it('en escritorio hay botón «Comparar modelos…» con aria-haspopup y sin lanzador abierto', () => {
    const html = renderToStaticMarkup(<CompareControls mode="code" directory="/repo" current={{ providerID: 'fake', modelID: 'a' }} />)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Comparar modelos…"')
    expect(html).not.toContain('compare-launcher')
  })
})

describe('el celular no ve la función', () => {
  it('CompareControls, la franja y el diálogo no pintan nada en la superficie remota', () => {
    installApi(fakeCompare().api, 'remote')
    expect(renderToStaticMarkup(<CompareControls mode="code" directory="/repo" current={{ providerID: 'fake', modelID: 'a' }} />)).toBe('')
    expect(renderToStaticMarkup(<CompareControls mode="chat" directory={null} current={{ providerID: 'fake', modelID: 'a' }} />)).toBe('')
    expect(renderToStaticMarkup(<RecoveryBanner mode="code" directory="/repo" />)).toBe('')
    expect(renderToStaticMarkup(<CompareConfirmDialog mode="chat" directory={null} />)).toBe('')
  })
  it('tampoco sin la API nativa (p. ej. navegador)', () => {
    installApi(null)
    expect(renderToStaticMarkup(<CompareControls mode="chat" directory={null} current={{ providerID: 'fake', modelID: 'a' }} />)).toBe('')
  })
})
