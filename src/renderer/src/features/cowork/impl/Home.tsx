/** Pantalla de inicio de Cowork: compositor grande, carpeta, modo de acceso y sugerencias por categoría. */
import { useState } from 'react'
import {
  BarChart3,
  FileText,
  FolderTree,
  Globe,
  Loader2,
  MonitorCog,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react'
import { AccessSegmented } from './AccessSegmented'
import { ComputerPermissionsCard, VisionModelHint } from './ComputerAccess'
import { CoworkComposer } from './CoworkComposer'
import { setAccessMode } from './actions'
import { useCowork } from './store'
import { baseName } from './util'

interface Category {
  id: string
  label: string
  icon: LucideIcon
  computer?: boolean
  items: Array<{ title: string; prompt: string }>
}

const CATEGORIES: Category[] = [
  {
    id: 'docs',
    label: 'Documentos',
    icon: FileText,
    items: [
      { title: 'Informe resumen', prompt: 'Lee todos los documentos de esta carpeta y crea un informe resumen.md con los puntos clave de cada uno.' },
      { title: 'Documento en Word', prompt: 'Redacta un documento en Word (.docx) bien formateado a partir de las notas de esta carpeta.' },
      { title: 'Revisión de ortografía', prompt: 'Revisa la ortografía y el estilo de los documentos .md y .txt y crea versiones corregidas con sufijo -revisado.' },
      { title: 'Acta de reunión', prompt: 'Convierte las notas de reunión de esta carpeta en un acta formal con acuerdos, responsables y fechas.' }
    ]
  },
  {
    id: 'data',
    label: 'Datos',
    icon: BarChart3,
    items: [
      { title: 'Analizar CSV', prompt: 'Analiza los archivos .csv de esta carpeta y crea un informe con totales, tendencias y hallazgos principales.' },
      { title: 'Limpiar datos', prompt: 'Limpia los datos de los .csv (duplicados, formatos de fecha, espacios) y guarda versiones limpias.' },
      { title: 'Gráficos', prompt: 'Genera gráficos PNG a partir de los datos de esta carpeta y un informe .md que los incluya.' },
      { title: 'Consolidar hojas', prompt: 'Consolida todos los .csv con la misma estructura en un único archivo y explica lo que hiciste.' }
    ]
  },
  {
    id: 'organize',
    label: 'Organizar archivos',
    icon: FolderTree,
    items: [
      { title: 'Ordenar por tipo', prompt: 'Ordena los archivos de esta carpeta en subcarpetas por tipo y crea un índice.md con lo que hay en cada una.' },
      { title: 'Renombrar con criterio', prompt: 'Propón nombres descriptivos y consistentes para los archivos de esta carpeta y renómbralos tras mostrarme el plan.' },
      { title: 'Encontrar duplicados', prompt: 'Busca archivos duplicados o casi duplicados en esta carpeta y dame un informe (no borres nada).' },
      { title: 'Inventario', prompt: 'Crea un inventario.csv con todos los archivos de la carpeta: nombre, tipo, tamaño y fecha.' }
    ]
  },
  {
    id: 'research',
    label: 'Investigación',
    icon: Globe,
    items: [
      { title: 'Informe de un tema', prompt: 'Investiga en la web sobre [tema] y escribe un informe.md con fuentes citadas.' },
      { title: 'Comparativa', prompt: 'Compara [opción A] y [opción B] buscando información en la web y entrega una tabla comparativa en .md.' },
      { title: 'Resumen de enlaces', prompt: 'Lee los enlaces que aparecen en los documentos de esta carpeta y resume cada uno en un informe.' },
      { title: 'Noticias recientes', prompt: 'Busca las noticias más recientes sobre [tema] y prepara un resumen ejecutivo de una página.' }
    ]
  },
  {
    id: 'computer',
    label: 'Control del Mac',
    icon: MonitorCog,
    computer: true,
    items: [
      { title: 'Crear carpeta', prompt: 'Crea una carpeta llamada Proyectos en el Escritorio.' },
      { title: 'Buscar en Safari', prompt: 'Abre Safari y busca el clima de hoy en Santiago.' },
      { title: 'Describir pantalla', prompt: 'Toma una captura de pantalla y dime qué hay abierto.' },
      { title: 'Ordenar Escritorio', prompt: 'Ordena los archivos sueltos del Escritorio en carpetas por tipo.' }
    ]
  }
]

export function Home({
  onSend,
  sendError,
  folderBusy
}: {
  onSend: (text: string) => Promise<void>
  sendError: string | null
  folderBusy: boolean
}): React.JSX.Element {
  const folder = useCowork((s) => s.folder)
  const phase = useCowork((s) => s.phase)
  const conn = useCowork((s) => s.conn)
  const requested = useCowork((s) => s.fullAccess)
  const full = conn ? conn.fullAccess : requested
  const [cat, setCat] = useState<string>(full ? 'computer' : 'docs')
  const category = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0]

  const pick = (prompt: string, computer?: boolean): void => {
    useCowork.setState({ draft: prompt })
    if (computer && !full && folder) void setAccessMode(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto w-full max-w-3xl py-10">
        <div className="mb-6 px-6 text-center">
          <h1 className="text-[32px] leading-tight font-medium tracking-tight">¿En qué trabajamos hoy?</h1>
          <p className="mt-2 text-sm text-muted">
            {!folder
              ? 'Elige una carpeta y describe el resultado que esperas. El agente planifica, trabaja solo y te entrega los archivos.'
              : full
                ? `Control total: el agente puede usar el ratón, el teclado y ver la pantalla. Detenlo con ⌘⇧Esc.`
                : `Trabajará dentro de «${baseName(folder)}». Te pedirá permiso antes de borrar nada.`}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <AccessSegmented disabled={folderBusy} />
            {phase === 'starting' && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" /> {requested ? 'Iniciando control total…' : 'Iniciando sandbox…'}
              </span>
            )}
          </div>
        </div>

        <ComputerPermissionsCard />
        <VisionModelHint />
        <CoworkComposer
          hero
          onSend={onSend}
          busy={false}
          disabled={phase === 'starting'}
          autoFocusKey={folder}
          placeholder={
            folder
              ? full
                ? 'Describe qué debe hacer en tu Mac…'
                : 'Describe la tarea que quieres delegar…'
              : 'Describe la tarea… (elige una carpeta para empezar)'
          }
        />
        {sendError && <p className="mx-auto mt-2 max-w-3xl px-6 text-xs text-danger">{sendError}</p>}
        {!full && folder && phase === 'ready' && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-subtle">
            <ShieldCheck size={12} /> Sandbox activo: no puede escribir fuera de la carpeta ni leer tus claves.
          </p>
        )}

        <div className="mt-8 px-6">
          <div className="mb-3 flex flex-wrap justify-center gap-1.5">
            {CATEGORIES.map((c) => {
              const Icon = c.icon
              const active = c.id === category.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCat(c.id)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? c.computer
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 [[data-theme=dark]_&]:text-amber-400'
                        : 'border-accent/50 bg-accent-soft text-accent'
                      : 'border-border text-muted hover:bg-hover hover:text-fg'
                  }`}
                >
                  <Icon size={13} /> {c.label}
                </button>
              )
            })}
          </div>
          {category.computer && !full && (
            <p className="mb-2 text-center text-xs text-muted">
              Estas tareas requieren <strong className="text-fg">Control total del Mac</strong>; al elegir una se te pedirá
              confirmación.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {category.items.map((s) => {
              const Icon = category.icon
              return (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => pick(s.prompt, category.computer)}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-elevated/50 px-3.5 py-3 text-left transition hover:border-border-strong hover:bg-hover"
                >
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      category.computer ? 'bg-amber-500/15 text-amber-600' : 'bg-accent-soft text-accent'
                    }`}
                  >
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.title}</span>
                    <span className="line-clamp-2 block text-xs text-muted">{s.prompt}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
