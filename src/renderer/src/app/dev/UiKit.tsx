/**
 * Kit de UI de escritorio (solo desarrollo): una página con todos los fundamentos y componentes base en cada variante, tamaño y
 * estado, para capturarla con `node scripts/shot-desktop.mjs --scenario kit` (ver docs/CAPTURAS-ESCRITORIO.md). La carga `main.tsx`
 * de forma perezosa SOLO si `location.hash === '#ui-kit'` y `localStorage['onyx.uikit'] === '1'`; la PWA nunca la importa.
 * Los nodos con `data-kit-state` (hover, active, focus-visible) los fuerza el script por CDP (`CSS.forcePseudoState`).
 * Texto de demostración fijo (no se traduce): no es parte de la interfaz de usuario.
 */
/* i18n-ignore: kit de desarrollo, no es interfaz de usuario */
import { Check, Download, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Badge, type BadgeTone } from '../../components/Badge'
import { Button, type ButtonSize, type ButtonVariant } from '../../components/Button'
import { Chip } from '../../components/Chip'
import { EmptyState } from '../../components/EmptyState'
import { IconButton, type IconButtonSize, ICON_BUTTON_ICON } from '../../components/IconButton'
import { Input, Select } from '../../components/Input'
import { Spinner } from '../../components/Spinner'
import { Toggle } from '../../components/Toggle'
import * as R from '../../components/ui/recipes'

type KitState = 'rest' | 'hover' | 'focus' | 'active' | 'disabled' | 'loading'
const STATES: KitState[] = ['rest', 'hover', 'focus', 'active', 'disabled', 'loading']
const FORCED: Partial<Record<KitState, string>> = { hover: 'hover', focus: 'focus-visible', active: 'active' }
const forced = (s: KitState): Record<string, string> => (FORCED[s] ? { 'data-kit-state': FORCED[s] as string } : {})

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section data-kit-section={id} className="mb-6 w-[1180px] rounded-xl border border-border bg-bg p-6">
      <h2 className="mb-4 text-base font-semibold desk:text-title-sm">{title}</h2>
      {children}
    </section>
  )
}

function Label({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="text-xs text-subtle desk:text-meta">{children}</div>
}

function Grid({ cols, children }: { cols: string[]; children: ReactNode }): React.JSX.Element {
  return (
    <div className="grid items-center gap-x-3 gap-y-2" style={{ gridTemplateColumns: `110px repeat(${cols.length}, minmax(0, 1fr))` }}>
      <span />
      {cols.map((c) => (
        <Label key={c}>{c}</Label>
      ))}
      {children}
    </div>
  )
}

const SAMPLE = 'Ñandú ágil 0123456789 ↑28 ↓136'

function Typography(): React.JSX.Element {
  const rows: [string, string][] = [
    ['text-caption 11', 'block desk:text-caption'],
    ['text-meta 12', 'block desk:text-meta'],
    ['text-ui 13', 'block desk:text-ui'],
    ['text-sm 14', 'text-sm'],
    ['text-prose 15', 'block desk:text-prose'],
    ['text-title-sm 15/600', 'block desk:text-title-sm'],
    ['text-title 20/600', 'block desk:text-title'],
    ['text-display 28/600', 'block desk:text-display']
  ]
  return (
    <Section id="tipografia" title="Tipografía">
      <div className="flex flex-col gap-2">
        {rows.map(([name, cls]) => (
          <div key={name} className="flex items-baseline gap-4">
            <span className="w-40 shrink-0 font-mono text-xs text-subtle">{name}</span>
            <span className={cls}>{SAMPLE}</span>
            <span className={`${cls} tabular-nums text-muted`}>0:01 1.234 +4 −2</span>
          </div>
        ))}
        <div className="flex items-baseline gap-4">
          <span className="w-40 shrink-0 font-mono text-xs text-subtle">font-code</span>
          <span className="font-mono text-xs desk:text-meta desk:font-code">const total = items.reduce((a, b) =&gt; a + b, 0)</span>
        </div>
        <div className="mt-2 flex items-center gap-6">
          <span className="text-xs text-subtle desk:text-meta">Hoy</span>
          <kbd className="kbd">⌘K</kbd>
          <input type="checkbox" defaultChecked aria-label="Casilla marcada" />
          <input type="checkbox" aria-label="Casilla vacía" />
          <input type="radio" defaultChecked aria-label="Radio" />
          <Settings size={16} />
          <Search size={14} />
          <Check size={12} />
        </div>
      </div>
    </Section>
  )
}

function Foundations(): React.JSX.Element {
  const spaces = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]
  const radii: [string, string][] = [
    ['2xs 4', 'block desk:rounded-2xs'],
    ['ctl-sm 6', 'block desk:rounded-ctl-sm'],
    ['ctl 8', 'block desk:rounded-ctl'],
    ['card 12', 'block desk:rounded-card'],
    ['modal 16', 'block desk:rounded-modal'],
    ['full', 'rounded-full']
  ]
  const shadows: [string, string][] = [
    ['0 plano', ''],
    ['1 raised', 'block desk:shadow-raised'],
    ['2 pop', 'block desk:shadow-pop'],
    ['3 modal', 'block desk:shadow-modal']
  ]
  return (
    <Section id="fundamentos" title="Espaciado, radios, elevación y velo">
      <div className="mb-5 flex items-end gap-3">
        {spaces.map((s) => (
          <div key={s} className="flex flex-col items-center gap-1">
            <div className="bg-accent" style={{ width: s, height: s }} />
            <span className="font-mono text-[10px] text-subtle">{s}</span>
          </div>
        ))}
      </div>
      <div className="mb-6 flex gap-4">
        {radii.map(([n, c]) => (
          <div
            key={n}
            className={`flex h-14 w-24 items-center justify-center border border-border-strong bg-elevated text-xs text-muted desk:text-meta ${c}`}
          >
            {n}
          </div>
        ))}
      </div>
      <div className="mb-6 flex gap-5">
        {shadows.map(([n, c]) => (
          <div
            key={n}
            className={`flex h-16 w-32 items-center justify-center rounded-xl border border-border bg-elevated text-xs text-muted desk:rounded-card desk:text-meta ${c}`}
          >
            {n}
          </div>
        ))}
      </div>
      <Label>Velo (--scrim) con diálogo (radio 16, sombra de nivel 3)</Label>
      <div className="mt-2 flex h-52 items-center justify-center rounded-xl bg-bg p-4 desk:bg-(--scrim)">
        <div className="w-80 rounded-2xl border border-border bg-elevated p-5 shadow-2xl desk:rounded-modal desk:shadow-modal">
          <div className="text-base font-semibold desk:text-title-sm">Eliminar la tarea</div>
          <div className="mt-2 text-sm text-muted">Esta acción no se puede deshacer.</div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost">Cancelar</Button>
            <Button variant="danger">Eliminar</Button>
          </div>
        </div>
      </div>
    </Section>
  )
}

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger', 'subtle', 'link']
const SIZES: ButtonSize[] = ['xs', 'sm', 'md', 'lg']

function Buttons(): React.JSX.Element {
  const icons: IconButtonSize[] = ['xs', 'sm', 'md', 'lg']
  return (
    <Section id="botones" title="Button, IconButton y Toggle">
      <div className="mb-3">
        <Label>Variantes × estados (md)</Label>
      </div>
      <Grid cols={STATES}>
        {VARIANTS.map((v) => (
          <Row key={v} name={v}>
            {STATES.map((s) => (
              <div key={s}>
                <Button variant={v} disabled={s === 'disabled'} loading={s === 'loading'} {...forced(s)}>
                  {v === 'link' ? 'Ver más' : 'Guardar'}
                </Button>
              </div>
            ))}
          </Row>
        ))}
      </Grid>
      <div className="my-5 flex flex-wrap items-center gap-6">
        {SIZES.map((sz) => (
          <div key={sz} className="flex items-center gap-2">
            <Label>{sz}</Label>
            <Button size={sz} variant="primary">
              <Plus size={sz === 'xs' ? 12 : 14} />
              Nuevo
            </Button>
            <Button size={sz}>Cancelar</Button>
          </div>
        ))}
      </div>
      <Grid cols={STATES}>
        {icons.map((sz) => (
          <Row key={sz} name={`IconButton ${sz}`}>
            {STATES.map((s) => (
              <div key={s}>
                <IconButton
                  label={`Borrar ${sz}`}
                  size={sz}
                  active={s === 'active' ? false : undefined}
                  disabled={s === 'disabled'}
                  {...forced(s)}
                >
                  {s === 'loading' ? (
                    <Spinner size={ICON_BUTTON_ICON[sz] === 18 ? 16 : (ICON_BUTTON_ICON[sz] as 12 | 14 | 16)} />
                  ) : (
                    <Trash2 size={ICON_BUTTON_ICON[sz]} />
                  )}
                </IconButton>
              </div>
            ))}
          </Row>
        ))}
      </Grid>
      <div className="mt-5 flex items-center gap-5">
        <Label>Toggle</Label>
        <Toggle checked={false} onChange={() => {}} label="Apagado" />
        <Toggle checked onChange={() => {}} label="Encendido" />
        <Toggle checked={false} onChange={() => {}} label="Deshabilitado" disabled />
        <Toggle checked onChange={() => {}} label="Encendido sm" size="sm" />
        <Toggle checked={false} onChange={() => {}} label="Apagado sm" size="sm" />
        <span data-kit-state="focus-visible" className="inline-flex">
          <Toggle checked onChange={() => {}} label="Con foco" />
        </span>
        <Label>Spinners</Label>
        {([12, 14, 16, 20] as const).map((n) => (
          <Spinner key={n} size={n} className="text-accent" />
        ))}
      </div>
    </Section>
  )
}

function Row({ name, children }: { name: string; children: ReactNode }): React.JSX.Element {
  return (
    <>
      <Label>{name}</Label>
      {children}
    </>
  )
}

const TONES: BadgeTone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'gold']

function Fields(): React.JSX.Element {
  return (
    <Section id="campos" title="Input, Select, Badge, Chip, pestañas y estado vacío">
      <div className="mb-5 grid grid-cols-4 gap-4">
        <div>
          <Label>Reposo</Label>
          <Input aria-label="Reposo" placeholder="Escribe…" />
        </div>
        <div>
          <Label>Foco</Label>
          <Input aria-label="Foco" defaultValue="Con foco" data-kit-state="focus" />
        </div>
        <div>
          <Label>Error</Label>
          <Input aria-label="Error" defaultValue="abc" error="Escribe un número" />
        </div>
        <div>
          <Label>Deshabilitado</Label>
          <Input aria-label="Deshabilitado" defaultValue="No editable" disabled />
        </div>
        <div>
          <Label>Select</Label>
          <Select aria-label="Select" defaultValue="b">
            <option value="a">Por fecha</option>
            <option value="b">Por nombre de archivo largo</option>
          </Select>
        </div>
        <div>
          <Label>Select con foco</Label>
          <Select aria-label="Select con foco" data-kit-state="focus">
            <option>Opción</option>
          </Select>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TONES.map((t) => (
          <Badge key={t} tone={t}>
            {t}
          </Badge>
        ))}
        <Badge tone="success" pill>
          Listo
        </Badge>
        <Badge pill>2 activas</Badge>
        <Badge tone="accent">1/3</Badge>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip icon={<Download size={14} />}>Sugerencia</Chip>
        <Chip selected>Seleccionado</Chip>
        <Chip {...forced('hover')}>Hover</Chip>
        <Chip {...forced('focus')}>Foco</Chip>
        <Chip disabled>Deshabilitado</Chip>
        <Chip variant="file">carrito.ts +4 −2</Chip>
        <Chip variant="file" icon={<X size={12} />}>
          precios.ts
        </Chip>
      </div>
      <div className="mb-5 flex flex-wrap items-start gap-8">
        <div className={R.SEGMENT}>
          <button type="button" className={`${R.SEGMENT_ITEM} ${R.SEGMENT_ITEM_ACTIVE}`}>
            Claro
          </button>
          <button type="button" className={R.SEGMENT_ITEM}>
            Oscuro
          </button>
          <button type="button" className={R.SEGMENT_ITEM}>
            Sistema
          </button>
        </div>
        <div className="flex gap-1">
          <button type="button" className={`${R.TAB} ${R.TAB_ACTIVE}`}>
            Cambios
          </button>
          <button type="button" className={R.TAB}>
            Terminal
          </button>
        </div>
        <div className={`${R.POP} w-52`}>
          <button type="button" className={`${R.MENU_ITEM} ${R.ROW_ACTIVE}`}>
            <Check size={14} /> Seleccionada
          </button>
          <button type="button" className={R.MENU_ITEM}>
            <Settings size={14} /> Ajustes
          </button>
          <button type="button" className={R.MENU_ITEM} disabled>
            <Trash2 size={14} /> Deshabilitada
          </button>
        </div>
        <div className="w-52">
          <button type="button" className={`${R.ROW} ${R.ROW_ACTIVE}`}>
            Fila seleccionada
          </button>
          <button type="button" className={R.ROW}>
            Fila de lista
          </button>
          <button type="button" className={R.ROW} {...forced('hover')}>
            Fila con hover
          </button>
        </div>
        <div
          role="presentation"
          className="flex items-center gap-2 rounded-md border border-border bg-elevated px-2 py-1 text-xs text-fg shadow-lg desk:rounded-ctl-sm desk:text-meta desk:shadow-pop"
        >
          Nueva conversación <kbd className="kbd">⌘N</kbd>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className={`${R.CARD_RAISED} p-4`}>
          <EmptyState
            icon={<Search size={20} />}
            title="Sin resultados"
            description="Prueba con otra búsqueda o quita un filtro."
            action={<Button size="sm">Limpiar filtros</Button>}
          />
        </div>
        <div className={`${R.CARD} p-4`}>
          <EmptyState icon={<Plus size={20} />} title="Aún no hay rutinas" />
        </div>
      </div>
    </Section>
  )
}

export default function UiKit(): React.JSX.Element {
  // Sin la app montada nadie pone data-theme: el kit sigue la preferencia del sistema (la que emula el script de capturas).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return (
    <div data-kit-root className="fixed inset-0 overflow-auto bg-bg p-6 text-fg">
      <Typography />
      <Foundations />
      <Buttons />
      <Fields />
    </div>
  )
}
