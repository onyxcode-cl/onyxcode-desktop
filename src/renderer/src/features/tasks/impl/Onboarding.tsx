/**
 * Tarjeta de primer uso de Tareas (se muestra desde `Home` hasta que se descarta; el estado vive en
 * localStorage `tasks.onboarded`): 3 pasos y una sección «Cómo usar las tareas de forma segura».
 */
import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, MonitorCog, Play, Shield, X } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { chooseFolder } from './actions'
import { useTasks } from './store'

function safetyTips(t: ReturnType<typeof useT>): string[] {
  return [
    t('tasksComputer.onb.tip1', { sandbox: TASKS_TERMS.sandbox, full: TASKS_TERMS.fullControl }),
    t('tasksComputer.onb.tip2'),
    t('tasksComputer.onb.tip3', { grant: TASKS_TERMS.deleteGrant }),
    t('tasksComputer.onb.tip4'),
    t('tasksComputer.onb.tip5', { full: TASKS_TERMS.fullControl }),
    t('tasksComputer.onb.tip6')
  ]
}

function Step({
  n,
  done,
  title,
  children,
  action
}: {
  n: number
  done?: boolean
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
          done ? 'bg-success/15 text-success' : 'bg-accent-soft text-accent'
        }`}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-0.5 text-[13px] leading-snug text-muted">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </li>
  )
}

const stepBtn =
  'flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1.5 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50'

export function Onboarding({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  const t = useT()
  const folder = useTasks((s) => s.folder)
  const phase = useTasks((s) => s.phase)
  const [safeOpen, setSafeOpen] = useState(false)

  const trySample = (): void => {
    useTasks.setState({ draft: t('tasksComputer.onb.samplePrompt') })
  }

  return (
    <section
      aria-labelledby="tasks-onboarding-title"
      className="mx-6 mb-5 rounded-2xl border border-border bg-elevated p-4 shadow-sm sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="tasks-onboarding-title" className="font-display text-base font-medium">
            {t('tasksComputer.onb.title')}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{t('tasksComputer.onb.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title={t('tasksComputer.onb.dismissTitle')}
          aria-label={t('tasksComputer.onb.dismissAria')}
          className="shrink-0 rounded-md p-1 text-subtle transition hover:bg-hover hover:text-fg"
        >
          <X size={15} />
        </button>
      </div>

      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        <Step
          n={1}
          done={!!folder}
          title={t('tasksComputer.onb.step1')}
          action={
            platformCaps().nativeDialogs ? (
              <button type="button" className={stepBtn} onClick={() => void chooseFolder()}>
                <FolderOpen size={13} /> {folder ? t('tasksComputer.onb.changeFolder') : t('tasksComputer.menu.choose')}
              </button>
            ) : undefined
          }
        >
          {t('tasksComputer.onb.step1Desc')}
        </Step>

        <Step n={2} title={t('tasksComputer.onb.step2')}>
          <span className="flex items-start gap-1.5">
            <Shield size={13} className="mt-0.5 shrink-0 text-accent" />
            <span>
              <strong className="font-medium text-fg">{TASKS_TERMS.sandbox}:</strong> {t('tasksComputer.onb.sandboxDesc')}
            </span>
          </span>
          <span className="mt-1.5 flex items-start gap-1.5">
            <MonitorCog size={13} className="mt-0.5 shrink-0 text-warning" />
            <span>
              <strong className="font-medium text-fg">{TASKS_TERMS.fullControl}:</strong> {t('tasksComputer.onb.fullDesc')}
            </span>
          </span>
        </Step>

        <Step
          n={3}
          title={t('tasksComputer.onb.step3')}
          action={
            <button type="button" className={stepBtn} disabled={!folder || phase === 'starting'} onClick={trySample}>
              <Play size={13} /> {t('tasksComputer.onb.fillSample')}
            </button>
          }
        >
          {t('tasksComputer.onb.step3Desc')} {!folder && t('tasksComputer.onb.pickFirst')}
        </Step>
      </ol>

      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setSafeOpen((o) => !o)}
          aria-expanded={safeOpen}
          aria-controls="tasks-safe-use"
          className="flex items-center gap-1.5 text-[13px] font-medium text-accent transition hover:underline"
        >
          {t('tasksComputer.onb.safe')}
          <ChevronDown size={14} className={`transition-transform ${safeOpen ? 'rotate-180' : ''}`} />
        </button>
        {safeOpen && (
          <ul id="tasks-safe-use" className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug text-muted marker:text-subtle">
            {safetyTips(t).map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-hover hover:text-fg"
        >
          {t('tasksComputer.onb.gotIt')}
        </button>
      </div>
    </section>
  )
}
