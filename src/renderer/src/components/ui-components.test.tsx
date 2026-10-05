import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'
import { Button } from './Button'
import { Chip } from './Chip'
import { DialogFrame } from './DialogFrame'
import { EmptyState } from './EmptyState'
import { IconButton } from './IconButton'
import { Input, Select } from './Input'
import { Toggle } from './Toggle'
import { Tooltip } from './Tooltip'
import * as R from './ui/recipes'

const html = (el: React.ReactElement): string => renderToStaticMarkup(el)

describe('componentes base nuevos', () => {
  it('Button: tamaños nuevos, variantes subtle/link y loading', () => {
    expect(html(<Button size="xs">x</Button>)).toContain('desk:h-6')
    expect(html(<Button size="lg">x</Button>)).toContain('desk:h-9')
    expect(html(<Button variant="subtle">x</Button>)).toContain('bg-accent-soft text-accent')
    const link = html(<Button variant="link">x</Button>)
    expect(link).toContain('hover:underline')
    expect(link).not.toContain('desk:h-')
    const busy = html(<Button loading>Guardar</Button>)
    expect(busy).toContain('aria-busy="true"')
    expect(busy).toContain('disabled=""')
    expect(busy).toContain('animate-spin')
    expect(busy).toContain('Guardar')
    expect(html(<Button>x</Button>)).not.toContain('aria-busy')
  })

  it('Button: la escala solo se queda en el primario', () => {
    expect(html(<Button variant="primary">x</Button>)).toContain('desk:active:scale-[0.97]')
    for (const v of ['secondary', 'ghost', 'danger', 'subtle'] as const)
      expect(html(<Button variant={v}>x</Button>)).toContain('desk:active:scale-100')
  })

  it('IconButton: tamaños xs y lg; tooltip opt-in quita el title nativo (en el servidor, sin portal)', () => {
    expect(html(<IconButton label="A">x</IconButton>)).toContain('h-8 w-8')
    expect(
      html(
        <IconButton label="A" size="xs">
          x
        </IconButton>
      )
    ).toContain('h-6 w-6')
    expect(
      html(
        <IconButton label="A" size="lg">
          x
        </IconButton>
      )
    ).toContain('h-9 w-9')
    expect(html(<IconButton label="A">x</IconButton>)).toContain('title="A"')
    const tip = html(
      <IconButton label="A" tooltip>
        x
      </IconButton>
    )
    expect(tip).not.toContain('title=')
    expect(tip).toContain('aria-label="A"')
  })

  it('Toggle sm', () => {
    const h = html(<Toggle checked onChange={() => {}} label="L" size="sm" />)
    expect(h).toContain('h-4 w-7')
    expect(h).toContain('translate-x-3.5')
  })

  it('Tooltip no añade nodos alrededor del hijo', () => {
    expect(html(<Tooltip label="Hola">{createElement('button', { type: 'button' }, 'x')}</Tooltip>)).toBe(
      '<button type="button">x</button>'
    )
    expect(html(<Tooltip label={undefined}>{createElement('button', { type: 'button' }, 'x')}</Tooltip>)).toBe(
      '<button type="button">x</button>'
    )
  })

  it('Badge, Chip, EmptyState', () => {
    expect(html(<Badge tone="success">Listo</Badge>)).toContain('text-success')
    expect(html(<Badge pill>2</Badge>)).toContain('rounded-full')
    expect(html(<Chip selected>f</Chip>)).toContain('aria-pressed="true"')
    expect(html(<Chip>f</Chip>)).not.toContain('aria-pressed')
    expect(html(<Chip variant="file">a.ts</Chip>)).toContain('font-mono')
    const e = html(<EmptyState icon={<i />} title="Nada" description="d" action={<b>ir</b>} />)
    expect(e).toContain('Nada')
    expect(e).toContain('<b>ir</b>')
  })

  it('Input y Select: estados de error accesibles', () => {
    const ok = html(<Input aria-label="n" />)
    expect(ok).not.toContain('aria-invalid')
    const bad = html(<Input aria-label="n" error="Obligatorio" />)
    expect(bad).toContain('aria-invalid="true"')
    expect(bad).toMatch(/aria-describedby="([^"]+)"/)
    const id = /aria-describedby="([^"]+)"/.exec(bad)?.[1]
    expect(bad).toContain(`id="${id}"`)
    expect(bad).toContain('Obligatorio')
    const sel = html(
      <Select aria-label="s" invalid>
        <option>a</option>
      </Select>
    )
    expect(sel).toContain('select-field')
    expect(sel).toContain('pr-8')
    expect(sel).toContain('aria-invalid="true"')
  })

  it('DialogFrame: rol, modal y título enlazado', () => {
    const d = html(
      <DialogFrame title="Titulo" onClose={() => {}} footer={<i>pie</i>}>
        cuerpo
      </DialogFrame>
    )
    expect(d).toContain('role="dialog"')
    expect(d).toContain('aria-modal="true"')
    const id = /aria-labelledby="([^"]+)"/.exec(d)?.[1]
    expect(d).toContain(`id="${id}"`)
    expect(d).toContain('desk:bg-(--scrim)')
    expect(
      html(
        <DialogFrame title="t" onClose={() => {}} alert>
          x
        </DialogFrame>
      )
    ).toContain('role="alertdialog"')
  })

  it('recetas: siempre una clase base antes de la primera desk: (Regla U)', () => {
    for (const [name, v] of Object.entries(R)) {
      expect(typeof v, name).toBe('string')
      const first = (v as string).split(' ')[0]
      expect(first.startsWith('desk:'), name).toBe(false)
    }
  })
})
