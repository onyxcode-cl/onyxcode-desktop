import { useState } from 'react'
import { Clock, FolderOpen, FolderCode } from 'lucide-react'
import { Button } from '../../../components/Button'
import { useSettings } from '../../../stores/settings'
import { errorMessage, getCodeApi } from './client'
import { useCode } from './store'

export function baseName(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function tildify(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

/** Abre el diálogo nativo y, si se elige, abre el proyecto. */
export async function pickAndOpenFolder(): Promise<void> {
  const { openProject, directory, setGlobalError } = useCode.getState()
  try {
    const dir = await getCodeApi().openFolder({ title: 'Abrir carpeta de proyecto', defaultPath: directory ?? undefined })
    if (dir) await openProject(dir)
  } catch (err) {
    setGlobalError(errorMessage(err))
  }
}

export function ProjectPicker(): React.JSX.Element {
  const recent = useSettings((s) => s.settings.recentFolders)
  const openProject = useCode((s) => s.openProject)
  const globalError = useCode((s) => s.globalError)
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <FolderCode size={24} />
          </div>
          <h1 className="text-xl font-semibold">Code</h1>
          <p className="mt-1 text-sm text-muted">Abre una carpeta para trabajar con el agente sobre tu proyecto.</p>
        </div>
        <Button
          variant="primary"
          className="w-full py-2"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void pickAndOpenFolder().finally(() => setBusy(false))
          }}
        >
          <FolderOpen size={16} /> Abrir carpeta
        </Button>
        {globalError && <div className="mt-3 text-center text-xs text-danger">{globalError}</div>}
        {recent.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-subtle uppercase">
              <Clock size={12} /> Recientes
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-elevated">
              {recent.slice(0, 10).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => void openProject(dir)}
                  className="flex w-full flex-col items-start border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-hover"
                >
                  <span className="text-sm font-medium">{baseName(dir)}</span>
                  <span className="w-full truncate font-mono text-xs text-subtle">{tildify(dir)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
