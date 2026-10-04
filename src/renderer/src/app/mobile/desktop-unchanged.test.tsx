import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { capsFor } from '@shared/platform-caps'
import { ConfirmDialogHost, confirmDialog, promptDialog } from '../../components/ConfirmDialog'
import { PopoverPanel } from '../../components/PopoverPanel'
import { ChatSessionList } from '../../features/chat/ChatSessionList'
import { SheetAction } from '../../features/code/impl/SheetAction'
import { isRemote, useIsRemote } from '../../lib/platform'
import { isSubmitKey } from '../../lib/textarea'

/** En Mac y Windows (superficie no remota) la interfaz móvil no actúa: mismo marcado, mismas teclas, mismas capacidades. */
describe('fuera de la superficie remota no cambia nada', () => {
  it('no se detecta superficie remota', () => {
    expect(isRemote()).toBe(false)
    expect(useIsRemote()).toBe(false)
    expect(capsFor('darwin').terminal).toBe(true)
    expect(capsFor('win32').nativeDialogs).toBe(true)
  })

  it('PopoverPanel es el mismo div con sus clases (sin hoja)', () => {
    const html = renderToStaticMarkup(
      createElement(PopoverPanel, { open: true, onClose: () => undefined, title: 'x', className: 'absolute z-40', children: 'hola' })
    )
    expect(html).toBe('<div class="absolute z-40">hola</div>')
    expect(renderToStaticMarkup(createElement(PopoverPanel, { open: false, onClose: () => undefined, title: 'x', children: 'a' }))).toBe('')
  })

  it('Enter sigue enviando en el compositor', () => {
    const ev = { key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false } }
    expect(isSubmitKey(ev)).toBe(true)
  })
})

/**
 * Marcado ACTUAL de escritorio de lo que la mejora estética móvil va a tocar (se fijó con el código de antes del cambio).
 * Regla: ningún literal de aquí se edita ni se regenera (nunca `vitest -u`). Si uno falla, el cambio móvil se escapó del escritorio.
 */
describe('marcado de escritorio de lo que se va a tocar', () => {
  afterEach(() => vi.useRealTimers())

  it('ConfirmDialogHost: confirmación peligrosa', () => {
    void confirmDialog({ title: 't', message: 'm', danger: true })
    expect(renderToStaticMarkup(createElement(ConfirmDialogHost))).toMatchInlineSnapshot(
      `"<div class="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"><div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" class="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl"><div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert lucide-alert-triangle" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></div><h3 id="confirm-dialog-title" class="text-base font-semibold">t</h3><p id="confirm-dialog-message" class="mt-2 text-sm leading-relaxed text-muted whitespace-pre-line">m</p><div class="mt-4 flex justify-end gap-2"><button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg">Cancelar</button><button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-90 bg-danger text-danger-fg">Aceptar</button></div></div></div>"`
    )
  })

  it('ConfirmDialogHost: pregunta con campo de texto', () => {
    void promptDialog({ title: 'p', message: 'm', defaultValue: 'x', placeholder: 'ph' })
    expect(renderToStaticMarkup(createElement(ConfirmDialogHost))).toMatchInlineSnapshot(
      `"<div class="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"><div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" class="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl"><div class="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-pencil" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"></path><path d="m15 5 4 4"></path></svg></div><h3 id="confirm-dialog-title" class="text-base font-semibold">p</h3><p id="confirm-dialog-message" class="mt-2 text-sm leading-relaxed text-muted whitespace-pre-line">m</p><input type="text" aria-labelledby="confirm-dialog-title" placeholder="ph" class="mt-3 w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent" value=""/><div class="mt-4 flex justify-end gap-2"><button type="button" class="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-fg">Cancelar</button><button type="button" class="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90">Aceptar</button></div></div></div>"`
    )
  })

  it('ChatSessionList: dos sesiones (hoy y ayer)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    const day = 86_400_000
    const now = Date.now()
    const mk = (id: string, title: string, at: number): Session => ({ id, title, time: { created: at, updated: at } }) as unknown as Session
    const html = renderToStaticMarkup(
      createElement(ChatSessionList, {
        sessions: [mk('a', 'Hoy', now), mk('b', 'Ayer', now - day)],
        activeId: 'a',
        onSelect: () => undefined,
        onRename: () => undefined,
        onDelete: () => undefined
      })
    )
    expect(html).toMatchInlineSnapshot(
      `"<div class="flex flex-col gap-4"><div><div class="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Hoy</div><div class="flex flex-col gap-px"><div class="group relative"><button type="button" aria-current="true" class="relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors duration-150 bg-active font-medium text-fg "><span class="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full bg-accent" aria-hidden="true"></span><span class="flex-1 truncate group-hover:pr-5">Hoy</span></button><button type="button" aria-label="Opciones" class="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 opacity-0 group-hover:opacity-100"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ellipsis lucide-more-horizontal" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button></div></div></div><div><div class="px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-subtle uppercase">Ayer</div><div class="flex flex-col gap-px"><div class="group relative"><button type="button" class="relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors duration-150 text-muted hover:bg-hover hover:text-fg "><span class="flex-1 truncate group-hover:pr-5">Ayer</span></button><button type="button" aria-label="Opciones" class="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-muted transition-opacity hover:bg-active hover:text-fg focus-visible:opacity-100 opacity-0 group-hover:opacity-100"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ellipsis lucide-more-horizontal" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button></div></div></div></div>"`
    )
  })

  it('ChatSessionList: cargando sin sesiones', () => {
    const html = renderToStaticMarkup(
      createElement(ChatSessionList, {
        sessions: [],
        activeId: null,
        loading: true,
        onSelect: () => undefined,
        onRename: () => undefined,
        onDelete: () => undefined
      })
    )
    expect(html).toMatchInlineSnapshot(
      `"<div class="flex flex-col gap-1.5 px-1 py-1" role="status" aria-busy="true" aria-label="Cargando"><div class="h-7 animate-pulse rounded-lg bg-hover/70" style="width:70%"></div><div class="h-7 animate-pulse rounded-lg bg-hover/70" style="width:55%"></div><div class="h-7 animate-pulse rounded-lg bg-hover/70" style="width:80%"></div><div class="h-7 animate-pulse rounded-lg bg-hover/70" style="width:45%"></div></div>"`
    )
  })

  it('SheetAction (normal y peligrosa)', () => {
    const base = { icon: createElement('i'), label: 'Renombrar', onClick: () => undefined }
    expect(renderToStaticMarkup(createElement(SheetAction, base))).toMatchInlineSnapshot(
      `"<button type="button" class="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] font-medium hover:bg-hover disabled:opacity-40 text-fg"><span class="shrink-0 text-muted"><i></i></span><span class="min-w-0 flex-1">Renombrar</span></button>"`
    )
    expect(renderToStaticMarkup(createElement(SheetAction, { ...base, danger: true, disabled: true }))).toMatchInlineSnapshot(
      `"<button type="button" disabled="" class="flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] font-medium hover:bg-hover disabled:opacity-40 text-danger"><span class="shrink-0 "><i></i></span><span class="min-w-0 flex-1">Renombrar</span></button>"`
    )
  })

  it('MobileSettings solo existe con props.mobile', () => {
    const src = readFileSync(resolve(__dirname, '../../features/settings/impl/SettingsView.tsx'), 'utf8')
    expect(src).toMatch(/mobile\s*\?/)
    expect(src.match(/<MobileSettings\b/g)?.length ?? 0).toBe(1)
    expect(src).toMatch(/props\.mobile|\bmobile\b[^\n]*MobileSettings|MobileSettings[^\n]*\bmobile\b/)
  })
})

/** CSS: lo móvil vive solo bajo `[data-surface='mobile']` y los valores de los tokens de escritorio no cambian. */
const SRC = resolve(__dirname, '../..')
const read = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8')

/** Selectores de las reglas de un CSS (fuera de `@keyframes` y de los bloques de cuerpo), sin comentarios. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let depth = 0
  let buf = ''
  const stack: boolean[] = [] // true = bloque transparente (@media/@supports/@layer), false = cuerpo o keyframes
  for (const ch of text) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      const parentOpaque = stack.some((t) => !t)
      if (!parentOpaque && !head.startsWith('@')) out.push(head)
      stack.push(head.startsWith('@') && !/^@(keyframes|font-face)/.test(head))
      depth++
    } else if (ch === '}') {
      stack.pop()
      depth--
      buf = ''
    } else if (ch === ';' && depth === 0) buf = ''
    else buf += ch
  }
  return out.flatMap(splitTop)
}

/** Separa por comas de primer nivel (las de dentro de `:is(…)`/`:not(…)` no cuentan). */
function splitTop(head: string): string[] {
  const parts: string[] = []
  let d = 0
  let cur = ''
  for (const ch of head) {
    if (ch === '(') d++
    if (ch === ')') d--
    if (ch === ',' && d === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  parts.push(cur.trim())
  return parts.filter(Boolean)
}

const MOBILE = /\[data-surface='mobile'\]/

describe('CSS móvil acotado a [data-surface=mobile]', () => {
  it('globals.css: el bloque «Superficie móvil» solo tiene selectores móviles', () => {
    const css = read('app/globals.css')
    const a = css.indexOf('*/', css.indexOf('Superficie móvil')) + 2 // tras el comentario de cabecera
    const b = css.indexOf('<select> nativo')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    const bad = selectors(css.slice(a, b)).filter((s) => !MOBILE.test(s))
    expect(bad).toEqual([])
  })

  it.each(['app/mobile/mobile-tokens.css', 'features/code/impl/mobile.css'])('%s: todos sus selectores son móviles', (rel) => {
    const bad = selectors(read(rel)).filter((s) => !MOBILE.test(s))
    expect(bad).toEqual([])
  })

  it('el selector de la guardia distingue reglas móviles de las que no lo son', () => {
    expect(selectors("a, b { x: y } @media (x) { [data-surface='mobile'] c { x: y } } @keyframes k { from { x: y } }")).toEqual([
      'a',
      'b',
      "[data-surface='mobile'] c"
    ])
  })

  it('las animaciones y tokens móviles nuevos de globals.css solo se añadieron (nada existente cambió de nombre)', () => {
    const css = read('app/globals.css')
    for (const n of ['fade-in', 'rise-in', 'sheet-up', 'pop-in', 'shimmer', 'caret']) expect(css).toContain(`--animate-${n}:`)
    expect(css).toMatch(/--animate-sheet-up: sheet-up var\(--dur-slow\) var\(--ease-out\) both;/)
  })

  /** Valores de escritorio que ningún agente móvil puede cambiar (tema claro y oscuro). */
  const LIGHT = {
    bg: '#f7f8fb',
    'bg-elevated': '#ffffff',
    fg: '#131722',
    'fg-muted': '#586074',
    border: '#e0e4ed',
    accent: '#2c4fd8',
    'accent-soft': '#e4e9ff',
    danger: '#b52f26'
  }
  const DARK = {
    bg: '#11131a',
    'bg-elevated': '#191c25',
    fg: '#e7e9f0',
    'fg-muted': '#a0a6b6',
    border: '#242835',
    accent: '#7d97ff',
    'accent-soft': '#1b2450',
    danger: '#ff7a6e'
  }
  const block = (css: string, head: string): string => {
    const i = css.indexOf(head)
    return css.slice(i, css.indexOf('}', i))
  }

  it.each([
    ['claro', ":root,\n[data-theme='light'] {", LIGHT],
    ['oscuro', "[data-theme='dark'] {", DARK]
  ] as const)('tokens de color de escritorio intactos (%s)', (_n, head, vals) => {
    const b = block(read('app/globals.css'), head)
    for (const [k, v] of Object.entries(vals)) expect(b).toContain(`--${k}: ${v};`)
  })

  it('tokens de movimiento y radios de escritorio intactos', () => {
    const b = block(read('app/globals.css'), '/* ---------- Tokens independientes del tema ---------- */\n:root {')
    for (const l of [
      '--radius-xl: 20px;',
      '--dur-fast: 120ms;',
      '--dur-base: 180ms;',
      '--dur-slow: 320ms;',
      '--ease-out: cubic-bezier(0.22, 1, 0.36, 1);',
      '--sidebar-width: 264px;'
    ])
      expect(b).toContain(l)
  })
})
