/**
 * Fijación del celular/PWA ANTES de tocar el código de Tareas: el marcado de la tarjeta de permiso y de la
 * barra en la superficie `remote` se congela con literales inline (nunca `vitest -u`). Tras el rediseño de
 * escritorio (bifurcación por `isRemoteSurface()`), este marcado debe quedar byte a byte igual.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../../test/strip-desk'

// Stub del store de Tareas (como en PermissionPrompt.render.test.tsx, pero con estado que el
// selector sí evalúa, para que ApprovalBar encuentre `autoPending`).
const mock = vi.hoisted(() => ({ state: { autoPending: {}, policy: {} } as Record<string, unknown> }))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
    getState: () => mock.state,
    setState: () => undefined,
    subscribe: () => () => undefined
  })
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { ApprovalBar, PermissionCard } from './PermissionPrompt'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const DIFF =
  'Index: /w/a.txt\n===================================================================\n--- /w/a.txt\n+++ /w/a.txt\n@@ -1,2 +1,2 @@\n uno\n-dos\n+DOS\n'

const req = (over: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({ id: 'per_1', sessionID: 's', permission: 'bash', patterns: ['ls'], metadata: {}, always: [], ...over }) as PermissionRequest

const html = (el: ReactNode): string => stripDesk(renderToStaticMarkup(el))

describe('celular/PWA: tarjeta de permiso de Tareas (sin cambios)', () => {
  it('bash simple', () => {
    surface('remote')
    expect(
      html(<PermissionCard request={req({ permission: 'bash', patterns: ['npm run build'], metadata: { command: 'npm run build' } })} />)
    ).toMatchInlineSnapshot(
      `"<div id="perm-per_1" tabindex="-1" class="rounded-xl border p-3.5 outline-none border-warning/40 bg-warning/5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-terminal" aria-hidden="true"><path d="M12 19h8"></path><path d="m4 17 6-6-6-6"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente quiere ejecutar un comando</p><p class="mt-0.5 text-xs text-muted">Se ejecutará este comando en la terminal de la carpeta.</p><pre class="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">npm run build</pre><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg mr-auto">Rechazar con indicaciones</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong " title="No volverá a preguntar en esta carpeta para: npm run build. Puedes quitarlo en Ajustes.">Permitir siempre</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover ">Permitir una vez</button></div></div></div></div>"`
    )
  })

  it('bash de borrado (destructivo, sin «siempre»)', () => {
    surface('remote')
    expect(
      html(
        <PermissionCard
          request={req({ permission: 'bash', patterns: ['rm -rf temporales/*'], metadata: { command: 'rm -rf temporales/*' } })}
        />
      )
    ).toMatchInlineSnapshot(
      `"<div id="perm-per_1" tabindex="-1" class="rounded-xl border p-3.5 outline-none border-danger/40 bg-danger/5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/15 text-danger"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash lucide-trash-2" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente quiere borrar archivos</p><p class="mt-0.5 text-xs text-muted">Se eliminarán de forma permanente los archivos o carpetas indicados en el comando.</p><pre class="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">rm -rf temporales/*</pre><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg mr-auto">Rechazar con indicaciones</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-danger text-danger-fg shadow-xs hover:brightness-110 ">Permitir una vez</button></div></div></div></div>"`
    )
  })

  it('edit con diff', () => {
    surface('remote')
    expect(
      html(<PermissionCard request={req({ permission: 'edit', patterns: ['a.txt'], metadata: { filepath: '/w/a.txt', diff: DIFF } })} />)
    ).toMatchInlineSnapshot(
      `"<div id="perm-per_1" tabindex="-1" class="rounded-xl border p-3.5 outline-none border-warning/40 bg-warning/5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-pen lucide-file-edit" aria-hidden="true"><path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente quiere modificar «a.txt»</p><p class="mt-0.5 text-xs text-muted">Se cambiará el contenido del archivo.</p><pre class="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">/w/a.txt</pre><div class="mt-2 overflow-hidden rounded-md border border-border bg-code"><div class="overflow-auto font-mono text-[12px] leading-[1.55] max-h-56"><table class="w-full border-collapse"><tbody><tr class="bg-accent-soft/60 text-muted"><td colSpan="4" class="px-3 py-0.5 max-w-0 truncate">@@ -1,2 +1,2 @@</td></tr><tr class=""><td class="hidden">1</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">1</td><td class="w-4 align-top select-none text-subtle"> </td><td class="pr-3 whitespace-pre-wrap break-all">uno</td></tr><tr class="bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"><td class="hidden">2</td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">2</td><td class="w-4 align-top select-none text-danger">-</td><td class="pr-3 whitespace-pre-wrap break-all">dos</td></tr><tr class="bg-[color-mix(in_srgb,var(--success)_13%,transparent)]"><td class="hidden"></td><td class="w-9 pr-1.5 pl-1 text-right align-top text-subtle/70 select-none">2</td><td class="w-4 align-top select-none text-success">+</td><td class="pr-3 whitespace-pre-wrap break-all">DOS</td></tr></tbody></table></div></div><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg mr-auto">Rechazar con indicaciones</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong " title="No volverá a preguntar en esta carpeta para: a.txt. Puedes quitarlo en Ajustes.">Permitir siempre</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover ">Permitir una vez</button></div></div></div></div>"`
    )
  })

  it('herramienta MCP', () => {
    surface('remote')
    expect(
      html(<PermissionCard request={req({ permission: 'github_create_issue', patterns: [], metadata: { repo: 'x/y', title: 'hola' } })} />)
    )
      .toMatchInlineSnapshot(`"<div id="perm-per_1" tabindex="-1" class="rounded-xl border p-3.5 outline-none border-warning/40 bg-warning/5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plug-zap lucide-plug-zap-2" aria-hidden="true"><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"></path><path d="m2 22 3-3"></path><path d="M7.5 13.5 10 11"></path><path d="M10.5 16.5 13 14"></path><path d="m18 3-4 4h6l-4 4"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente quiere usar create_issue de github</p><p class="mt-0.5 text-xs text-muted">Es una herramienta de un conector (MCP) externo: se ejecutará con los parámetros indicados.</p><pre class="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">{
  &quot;repo&quot;: &quot;x/y&quot;,
  &quot;title&quot;: &quot;hola&quot;
}</pre><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg mr-auto">Rechazar con indicaciones</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover ">Permitir una vez</button></div></div></div></div>"`)
  })

  it('doom_loop', () => {
    surface('remote')
    expect(html(<PermissionCard request={req({ permission: 'doom_loop', patterns: ['repetir'] })} />)).toMatchInlineSnapshot(
      `"<div id="perm-per_1" tabindex="-1" class="rounded-xl border p-3.5 outline-none border-warning/40 bg-warning/5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-repeat" aria-hidden="true"><path d="m17 2 4 4-4 4"></path><path d="M3 11v-1a4 4 0 0 1 4-4h14"></path><path d="m7 22-4-4 4-4"></path><path d="M21 13v1a4 4 0 0 1-4 4H3"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente está repitiendo la misma acción</p><p class="mt-0.5 text-xs text-muted">Parece atascado. Si lo permites, volverá a intentar lo mismo; si lo rechazas, se detendrá y te explicará.</p><pre class="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">repetir</pre><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg mr-auto">Rechazar con indicaciones</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover ">Permitir una vez</button></div></div></div></div>"`
    )
  })

  it('barra de aprobación con una petición', () => {
    surface('remote')
    expect(
      html(<ApprovalBar requests={[req({ permission: 'bash', patterns: ['npm run build'], metadata: { command: 'npm run build' } })]} />)
    ).toMatchInlineSnapshot(
      `"<div class="mx-auto mb-2 w-full max-w-3xl px-6 animate-rise-in"><div class="flex items-center gap-3 rounded-xl border px-3 py-2 shadow-sm border-warning/50 bg-warning/10"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-terminal shrink-0 text-warning" aria-hidden="true"><path d="M12 19h8"></path><path d="m4 17 6-6-6-6"></path></svg><button type="button" class="min-w-0 flex-1 text-left" title="Ver detalles"><span class="block truncate text-sm font-medium">El agente quiere ejecutar un comando</span><span class="block truncate font-mono text-[11px] text-muted">npm run build</span></button><div class="flex shrink-0 items-center gap-1.5"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg !px-2 !py-1 text-xs">Rechazar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong !px-2 !py-1 text-xs" title="No volverá a preguntar en esta carpeta para: npm run build. Puedes quitarlo en Ajustes.">Siempre</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover !px-2.5 !py-1 text-xs">Permitir una vez</button></div></div></div>"`
    )
  })
})
