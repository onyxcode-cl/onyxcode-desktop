/** Pantalla de inicio de Tareas: compositor grande, carpeta, modo de acceso y sugerencias por categoría. */
import { ErrorNotice } from '../../../components/conversation/ErrorNotice'
import { useState } from 'react'
import { BarChart3, Eye, EyeOff, FileText, FolderTree, Globe, Loader2, MonitorCog, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { MsgKey, Params } from '@shared/i18n'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { useT } from '../../../lib/i18n'
import { AccessSegmented } from './AccessSegmented'
import { ComputerPermissionsCard, FullWorkspaceNote, VisionModelHint } from './ComputerAccess'
import { TasksComposer } from './TasksComposer'
import { setAccessMode } from './actions'
import { Onboarding } from './Onboarding'
import { useTasks } from './store'
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

/** Categorías de plantillas de inicio en el idioma activo (se calculan al pintar). */
export function getCategories(t: (key: MsgKey, params?: Params) => string): HomeCategory[] {
  const moveNote = t('tasks.home.moveNote', { term: TASKS_TERMS.deleteGrant })
  return [
    {
      id: 'docs',
      label: t('tasks.home.cat.docs'),
      icon: FileText,
      items: [
        {
          title: t('tasks.home.tpl.docs.0.title'),
          prompt: t('tasks.home.tpl.docs.0.prompt')
        },
        {
          title: t('tasks.home.tpl.docs.1.title'),
          prompt: t('tasks.home.tpl.docs.1.prompt')
        },
        {
          title: t('tasks.home.tpl.docs.2.title'),
          prompt: t('tasks.home.tpl.docs.2.prompt')
        },
        {
          title: t('tasks.home.tpl.docs.3.title'),
          prompt: t('tasks.home.tpl.docs.3.prompt')
        }
      ]
    },
    {
      id: 'data',
      label: t('tasks.home.cat.data'),
      icon: BarChart3,
      items: [
        {
          title: t('tasks.home.tpl.data.0.title'),
          prompt: t('tasks.home.tpl.data.0.prompt')
        },
        {
          title: t('tasks.home.tpl.data.1.title'),
          prompt: t('tasks.home.tpl.data.1.prompt')
        },
        {
          title: t('tasks.home.tpl.data.2.title'),
          prompt: t('tasks.home.tpl.data.2.prompt')
        },
        {
          title: t('tasks.home.tpl.data.3.title'),
          prompt: t('tasks.home.tpl.data.3.prompt')
        }
      ]
    },
    {
      id: 'organize',
      label: t('tasks.home.cat.organize'),
      icon: FolderTree,
      items: [
        {
          title: t('tasks.home.tpl.organize.0.title'),
          prompt: t('tasks.home.tpl.organize.0.prompt'),
          note: moveNote
        },
        {
          title: t('tasks.home.tpl.organize.1.title'),
          prompt: t('tasks.home.tpl.organize.1.prompt'),
          note: moveNote
        },
        {
          title: t('tasks.home.tpl.organize.2.title'),
          prompt: t('tasks.home.tpl.organize.2.prompt')
        },
        {
          title: t('tasks.home.tpl.organize.3.title'),
          prompt: t('tasks.home.tpl.organize.3.prompt')
        }
      ]
    },
    {
      id: 'research',
      label: t('tasks.home.cat.research'),
      icon: Globe,
      items: [
        {
          title: t('tasks.home.tpl.research.0.title'),
          prompt: t('tasks.home.tpl.research.0.prompt')
        },
        {
          title: t('tasks.home.tpl.research.1.title'),
          prompt: t('tasks.home.tpl.research.1.prompt')
        },
        {
          title: t('tasks.home.tpl.research.2.title'),
          prompt: t('tasks.home.tpl.research.2.prompt')
        },
        {
          title: t('tasks.home.tpl.research.3.title'),
          prompt: t('tasks.home.tpl.research.3.prompt')
        }
      ]
    },
    {
      id: 'computer',
      label: t('tasks.home.cat.computer'),
      icon: MonitorCog,
      computer: true,
      items: [
        {
          title: t('tasks.home.tpl.computer.0.title'),
          prompt: t('tasks.home.tpl.computer.0.prompt')
        },
        {
          title: t('tasks.home.tpl.computer.1.title'),
          prompt: t('tasks.home.tpl.computer.1.prompt')
        },
        {
          title: t('tasks.home.tpl.computer.2.title'),
          prompt: t('tasks.home.tpl.computer.2.prompt')
        },
        {
          title: t('tasks.home.tpl.computer.3.title'),
          prompt: t('tasks.home.tpl.computer.3.prompt')
        }
      ]
    }
  ]
}

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
  sendError: unknown
  folderBusy: boolean
}): React.JSX.Element {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const phase = useTasks((s) => s.phase)
  const conn = useTasks((s) => s.conn)
  const requested = useTasks((s) => s.fullAccess)
  const full = conn ? conn.fullAccess : requested
  const [cat, setCat] = useState<string>(full ? 'computer' : 'docs')
  const categories = getCategories(t)
  const category = categories.find((c) => c.id === cat) ?? categories[0]
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
    useTasks.setState({ draft: prompt })
    if (computer && !full) void setAccessMode(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="m-auto w-full max-w-3xl py-10">
        <div className="mb-6 px-6 text-center">
          <h1 className="font-display text-[32px] leading-tight font-medium tracking-tight">{t('tasks.home.title')}</h1>
          <p className="mt-2 text-sm text-muted">
            {!folder
              ? t('tasks.home.lead.noFolder')
              : full
                ? t('tasks.home.lead.full')
                : t('tasks.home.lead.sandbox', { folder: baseName(folder) })}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <AccessSegmented disabled={folderBusy} />
            {phase === 'starting' && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Loader2 size={12} className="animate-spin" /> {requested ? t('tasks.home.startingFull') : t('tasks.home.startingSandbox')}
              </span>
            )}
          </div>
        </div>

        {!onboarded && <Onboarding onDismiss={() => setOnboardedPersisted(true)} />}
        <FullWorkspaceNote canChange={!folderBusy} />
        <ComputerPermissionsCard />
        <VisionModelHint />
        <TasksComposer
          hero
          onSend={onSend}
          busy={false}
          disabled={phase === 'starting'}
          autoFocusKey={folder}
          placeholder={folder ? (full ? t('tasks.home.ph.full') : t('tasks.home.ph.folder')) : t('tasks.home.ph.noFolder')}
        />
        {sendError != null && (
          <div className="mx-auto mt-2 max-w-3xl px-6">
            <ErrorNotice error={sendError} />
          </div>
        )}
        {!full && folder && phase === 'ready' && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-subtle">
            <ShieldCheck size={12} /> {t('tasks.home.sandboxActive')}
          </p>
        )}

        <div className="mt-8 px-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium text-muted">{t('tasks.home.suggestions')}</h2>
            <button
              type="button"
              onClick={toggleHidden}
              aria-pressed={hidden}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-hover hover:text-fg"
            >
              {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
              {hidden ? t('tasks.home.show') : t('tasks.home.hide')}
            </button>
          </div>
          {!hidden && (
            <>
              <div className="mb-3 flex flex-wrap justify-center gap-1.5" role="group" aria-label={t('tasks.home.catAria')}>
                {categories.map((c) => {
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
                  {t('tasks.home.needsFull.pre')}
                  <strong className="text-fg">{TASKS_TERMS.fullControl}</strong>
                  {t('tasks.home.needsFull.post')}
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
                {t('tasks.home.safeUse')}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
