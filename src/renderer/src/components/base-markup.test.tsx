/**
 * Marcado de los componentes base tal como lo ve el celular y como era antes del rediseño de escritorio: se escribió a mano
 * desde el render anterior (nunca con `-u`). `stripDesk()` quita solo las clases `desk:` (la variante de escritorio, que no actúa
 * en la PWA), así que cualquier otro cambio de clases en una variante existente rompe esta prueba.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { stripDesk } from '../../../test/strip-desk'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Spinner } from './Spinner'
import { Toggle } from './Toggle'

const BTN =
  'no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50'
const SM = 'px-2.5 py-1 text-[13px] gap-1.5'
const MD = 'px-3 py-1.5 text-sm gap-2'
const V = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover',
  secondary: 'bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-danger-fg shadow-xs hover:brightness-110'
} as const
const btn = (size: string, variant: string): string => `<button type="button" class="${BTN} ${size} ${variant} ">x</button>`

describe('Button: marcado existente intacto', () => {
  for (const variant of Object.keys(V) as (keyof typeof V)[]) {
    it(`${variant} md y sm`, () => {
      expect(stripDesk(renderToStaticMarkup(<Button variant={variant}>x</Button>))).toBe(btn(MD, V[variant]))
      expect(stripDesk(renderToStaticMarkup(<Button variant={variant} size="sm">x</Button>))).toBe(btn(SM, V[variant]))
    })
  }
  it('por defecto es secondary md y respeta className', () => {
    expect(stripDesk(renderToStaticMarkup(<Button>x</Button>))).toBe(btn(MD, V.secondary))
    expect(stripDesk(renderToStaticMarkup(<Button className="w-full">x</Button>))).toBe(btn(MD, V.secondary).replace(' ">', ' w-full">'))
  })
})

const ICON =
  'no-drag inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-fg active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent'
const icon = (sz: string, active: string): string => `<button type="button" title="Cerrar" aria-label="Cerrar" class="${ICON} ${sz} ${active} ">x</button>`

describe('IconButton: marcado existente intacto', () => {
  it('md, sm y activo', () => {
    expect(stripDesk(renderToStaticMarkup(<IconButton label="Cerrar">x</IconButton>))).toBe(icon('h-8 w-8', ''))
    expect(stripDesk(renderToStaticMarkup(<IconButton label="Cerrar" size="sm">x</IconButton>))).toBe(icon('h-7 w-7', ''))
    expect(stripDesk(renderToStaticMarkup(<IconButton label="Cerrar" active>x</IconButton>))).toBe(icon('h-8 w-8', 'bg-active text-fg'))
  })
})

const TOG = 'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40'
const KNOB = 'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out'
const tog = (checked: boolean, dis: boolean): string =>
  `<button type="button" role="switch" aria-checked="${checked}" aria-label="Modo" title="Modo"${dis ? ' disabled=""' : ''} class="${TOG} ${checked ? 'bg-accent' : 'bg-border-strong'}"><span class="${KNOB} ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}"></span></button>`

describe('Toggle: marcado existente intacto', () => {
  it('apagado, encendido y deshabilitado', () => {
    const f = (): void => {}
    expect(stripDesk(renderToStaticMarkup(<Toggle checked={false} onChange={f} label="Modo" />))).toBe(tog(false, false))
    expect(stripDesk(renderToStaticMarkup(<Toggle checked onChange={f} label="Modo" />))).toBe(tog(true, false))
    expect(stripDesk(renderToStaticMarkup(<Toggle checked onChange={f} label="Modo" disabled />))).toBe(tog(true, true))
  })
})

describe('Spinner: igual que el Loader2 escrito a mano', () => {
  it('mismo marcado que Loader2 + animate-spin', async () => {
    const { Loader2 } = await import('lucide-react')
    for (const size of [12, 14, 16, 20] as const) {
      expect(renderToStaticMarkup(<Spinner size={size} />)).toBe(renderToStaticMarkup(<Loader2 size={size} className="animate-spin" />))
      expect(renderToStaticMarkup(<Spinner size={size} className="text-accent" />)).toBe(
        renderToStaticMarkup(<Loader2 size={size} className="animate-spin text-accent" />)
      )
    }
  })
  it('con etiqueta es un estado accesible', () => {
    const html = renderToStaticMarkup(<Spinner label="Cargando" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Cargando"')
    expect(html).not.toContain('aria-hidden')
  })
})
