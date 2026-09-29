/** Pantalla de inicio de Cowork: compositor grande, carpeta, modo de acceso y sugerencias por categoría. */
import { useState } from 'react'
import { BarChart3, Eye, EyeOff, FileText, FolderTree, Globe, Loader2, MonitorCog, ShieldCheck, type LucideIcon } from 'lucide-react'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { AccessSegmented } from './AccessSegmented'
import { ComputerPermissionsCard, VisionModelHint } from './ComputerAccess'
import { CoworkComposer } from './CoworkComposer'
import { setAccessMode } from './actions'
import { Onboarding } from './Onboarding'
import { useCowork } from './store'
import { baseName } from './util'

/** Plantilla de inicio. `note` es un aviso que se muestra en Sandbox (p. ej. permisos que se pedirán). */
export interface HomeTemplate {
  title: string
  prompt: string
  note?: string
}

export interface HomeCategory {
  id: string
  label: string
  icon: LucideIcon
  computer?: boolean
  items: HomeTemplate[]
}

/** Aviso de las plantillas que mueven o renombran archivos dentro del sandbox. */
const MOVE_NOTE = `Al mover archivos en Sandbox se te pedirá el permiso «${COWORK_TERMS.deleteGrant}»; sin él, ofrecerá una copia ordenada.`

/**
 * Plantillas de inicio: 5 categorías × 4. Todas siguen el patrón «primero revisa y resume; luego propón;
 * cuando lo apruebe, actúa», para que el agente enseñe lo que va a hacer antes de tocar nada.
 */
export const CATEGORIES: HomeCategory[] = [
  {
    id: 'docs',
    label: 'Documentos',
    icon: FileText,
    items: [
      {
        title: 'Informe resumen',
        prompt:
          'Primero revisa los documentos de esta carpeta y muéstrame un resumen de qué hay en cada uno; luego propón la estructura de un informe resumen.md con los puntos clave; cuando lo apruebe, escríbelo en la carpeta.'
      },
      {
        title: 'Documento en Word',
        prompt:
          'Primero revisa las notas de esta carpeta y muéstrame un resumen de las ideas principales; luego propón el esquema de un documento Word (.docx) con sus secciones; cuando lo apruebe, créalo bien formateado.'
      },
      {
        title: 'Revisión de ortografía',
        prompt:
          'Primero revisa los documentos .md y .txt de esta carpeta y muéstrame un resumen de los errores de ortografía y estilo que encuentres; luego propón las correcciones; cuando lo apruebe, guarda versiones corregidas con el sufijo -revisado sin tocar los originales.'
      },
      {
        title: 'Acta de reunión',
        prompt:
          'Primero revisa las notas de reunión de esta carpeta y muéstrame un resumen de los temas tratados; luego propón la lista de acuerdos, responsables y fechas; cuando lo apruebe, redacta un acta formal en actas.md.'
      }
    ]
  },
  {
    id: 'data',
    label: 'Datos',
    icon: BarChart3,
    items: [
      {
        title: 'Analizar CSV',
        prompt:
          'Primero revisa los archivos .csv de esta carpeta y muéstrame un resumen de sus columnas, filas y datos faltantes; luego propón qué análisis harías (totales, tendencias, valores atípicos); cuando lo apruebe, ejecútalo y guarda un informe con los hallazgos principales.'
      },
      {
        title: 'Limpiar datos',
        prompt:
          'Primero revisa los .csv de esta carpeta y muéstrame un resumen de los problemas (duplicados, fechas en formatos distintos, espacios sobrantes); luego propón las reglas de limpieza; cuando lo apruebe, guarda versiones limpias sin modificar los originales.'
      },
      {
        title: 'Gráficos',
        prompt:
          'Primero revisa los datos de esta carpeta y muéstrame un resumen de qué variables se pueden graficar; luego propón 3 o 4 gráficos con su tipo y qué muestran; cuando lo apruebe, genéralos como PNG e inclúyelos en un informe .md.'
      },
      {
        title: 'Consolidar hojas',
        prompt:
          'Primero revisa los .csv de esta carpeta y muéstrame un resumen de cuáles tienen la misma estructura; luego propón cómo unirlos y cómo tratarías los duplicados; cuando lo apruebe, crea un único archivo consolidado y explica lo que hiciste.'
      }
    ]
  },
  {
    id: 'organize',
    label: 'Organizar archivos',
    icon: FolderTree,
    items: [
      {
        title: 'Ordenar por tipo',
        prompt:
          'Primero revisa los archivos de esta carpeta y muéstrame un resumen de cuántos hay de cada tipo; luego propón una estructura de subcarpetas y qué archivo iría a cada una; cuando lo apruebe, muévelos y crea un índice.md. Si mover está bloqueado, crea una copia ordenada sin tocar los originales.',
        note: MOVE_NOTE
      },
      {
        title: 'Renombrar con criterio',
        prompt:
          'Primero revisa los nombres de los archivos de esta carpeta y muéstrame un resumen de las inconsistencias; luego propón una tabla con el nombre actual y el nuevo; cuando lo apruebe, renómbralos. Si renombrar está bloqueado, crea copias con los nombres nuevos.',
        note: MOVE_NOTE
      },
      {
        title: 'Encontrar duplicados',
        prompt:
          'Primero revisa esta carpeta y muéstrame un resumen de los archivos duplicados o casi duplicados que encuentres; luego propón cuál conservar de cada grupo y por qué; cuando lo apruebe, escribe el informe duplicados.md. No borres nada.'
      },
      {
        title: 'Inventario',
        prompt:
          'Primero revisa los archivos de esta carpeta y muéstrame un resumen de qué hay (tipos, tamaños y fechas); luego propón las columnas del inventario; cuando lo apruebe, crea un inventario.csv con nombre, tipo, tamaño y fecha de cada archivo.'
      }
    ]
  },
  {
    id: 'research',
    label: 'Investigación',
    icon: Globe,
    items: [
      {
        title: 'Informe de un tema',
        prompt:
          'Primero busca en la web sobre [tema] y muéstrame un resumen de lo que encuentres con las fuentes; luego propón el índice de un informe; cuando lo apruebe, escribe informe.md con las fuentes citadas.'
      },
      {
        title: 'Comparativa',
        prompt:
          'Primero busca información en la web sobre [opción A] y [opción B] y muéstrame un resumen de cada una; luego propón los criterios de comparación; cuando lo apruebe, entrega una tabla comparativa en comparativa.md con las fuentes.'
      },
      {
        title: 'Resumen de enlaces',
        prompt:
          'Primero revisa los documentos de esta carpeta y muéstrame la lista de enlaces que aparecen; luego propón cuáles vale la pena leer y en qué orden; cuando lo apruebe, léelos y resume cada uno en un informe.'
      },
      {
        title: 'Noticias recientes',
        prompt:
          'Primero busca las noticias más recientes sobre [tema] y muéstrame un resumen de los titulares con su fuente y fecha; luego propón los 5 puntos que más importan; cuando lo apruebe, prepara un resumen ejecutivo de una página.'
      }
    ]
  },
  {
    id: 'computer',
    label: 'Control del Mac',
    icon: MonitorCog,
    computer: true,
    items: [
      {
        title: 'Crear carpeta',
        prompt:
          'Primero mira el Escritorio y dime si ya existe una carpeta llamada Proyectos; luego propón el plan; cuando lo apruebe, crea la carpeta Proyectos en el Escritorio.'
      },
      {
        title: 'Buscar en Safari',
        prompt:
          'Primero dime qué tienes abierto en Safari; luego propón los pasos para buscar el clima de hoy en Santiago; cuando lo apruebe, hazlo y dime el resultado.'
      },
      {
        title: 'Describir pantalla',
        prompt:
          'Primero toma una captura de pantalla y muéstrame un resumen de qué apps y ventanas hay abiertas; luego propón qué podrías hacer con ellas; cuando lo apruebe, hazlo. No cierres ni modifiques nada por tu cuenta.'
      },
      {
        title: 'Ordenar Escritorio',
        prompt:
          'Primero revisa el Escritorio y muéstrame un resumen de los archivos sueltos que hay; luego propón las carpetas por tipo y qué iría a cada una; cuando lo apruebe, muévelos.'
      }
    ]
  }
]

const HIDE_KEY = 'tasks.hideSuggestions'
const ONBOARDED_KEY = 'tasks.onboarded'

/** Lee un indicador de localStorage ('1' = activo). Sin storage devuelve el valor por defecto. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // sin storage: el valor solo dura mientras la ventana siga abierta
  }
}

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
  const [hidden, setHidden] = useState(() => readFlag(HIDE_KEY, false))
  const [onboarded, setOnboarded] = useState(() => readFlag(ONBOARDED_KEY, false))

  const toggleHidden = (): void => {
    const next = !hidden
    setHidden(next)
    writeFlag(HIDE_KEY, next)
  }
  const setOnboardedPersisted = (value: boolean): void => {
    setOnboarded(value)
    writeFlag(ONBOARDED_KEY, value)
  }

  const pick = (prompt: string, computer?: boolean): void => {
    useCowork.setState({ draft: prompt })
    if (computer && !full && folder) void setAccessMode(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto w-full max-w-3xl py-10">
        <div className="mb-6 px-6 text-center">
          <h1 className="font-display text-[32px] leading-tight font-medium tracking-tight">¿En qué trabajamos hoy?</h1>
          <p className="mt-2 text-sm text-muted">
            {!folder
              ? 'Elige una carpeta y describe el resultado que esperas. El agente revisa, te propone un plan y, cuando lo apruebes, trabaja y te entrega los archivos.'
              : full
                ? `Control total: el agente puede usar el ratón, el teclado y ver la pantalla. Detenlo con ⌘⇧Esc.`
                : `Trabajará dentro de «${baseName(folder)}». Te pedirá permiso antes de borrar, mover o renombrar.`}
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

        {!onboarded && <Onboarding onDismiss={() => setOnboardedPersisted(true)} />}
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium text-muted">Sugerencias para empezar</h2>
            <button
              type="button"
              onClick={toggleHidden}
              aria-pressed={hidden}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg"
            >
              {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              {hidden ? 'Mostrar sugerencias' : 'Ocultar sugerencias'}
            </button>
          </div>
          {!hidden && (
            <>
              <div className="mb-3 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Categorías de sugerencias">
                {CATEGORIES.map((c) => {
                  const Icon = c.icon
                  const active = c.id === category.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCat(c.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? c.computer
                            ? 'border-warning/50 bg-warning/10 text-warning'
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
                  Estas tareas requieren <strong className="text-fg">{COWORK_TERMS.fullControl}</strong>; al elegir una se te pedirá
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
                          category.computer ? 'bg-warning/15 text-warning' : 'bg-accent-soft text-accent'
                        }`}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.title}</span>
                        <span className="line-clamp-2 block text-xs text-muted">{s.prompt}</span>
                        {s.note && !full && <span className="mt-1 block text-[11.5px] leading-snug text-warning">{s.note}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {onboarded && (
            <p className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setOnboardedPersisted(false)}
                className="text-xs text-muted underline-offset-2 transition hover:text-fg hover:underline"
              >
                Cómo usar las tareas de forma segura
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
