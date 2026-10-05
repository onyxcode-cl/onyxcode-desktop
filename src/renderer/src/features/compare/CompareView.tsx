/**
 * Vista de la comparación: cabecera con las acciones generales y una columna por modelo (mín. 300 px, desplazable en
 * horizontal). No se muestra en la interfaz del celular (el celular no usa `compare:*`).
 */
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CompareColumnManifest, CompareManifest, CompareMode } from '@shared/ipc-code'
import { Button } from '../../components/Button'
import { confirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../lib/i18n'
import type { MessageEntry } from '../../lib/session-reducer'
import { useProviders } from '../../stores/providers'
import type { PendingPermission } from '../code/impl/types'
import { compareApi } from './api'
import { CompareColumn } from './CompareColumn'
import { DiffDrawer } from './DiffDrawer'
import { columnBadges, isActiveManifest, isFinished } from './model'
import {
  cancelColumn,
  closeCompare,
  colKey,
  discardColumn,
  exportBench,
  keepColumn,
  loadDiff,
  pushNotice,
  replyPermission,
  retryColumn,
  useCompare,
  type AdoptFailure,
  type DiffState
} from './store'
import { useNow } from './useNow'

export interface AdoptedInfo {
  mode: CompareMode
  column: CompareColumnManifest
  files: string[]
  promptPreview: string
}

interface Props {
  id: string
  /** Se llama tras elegir una columna (y cerrar la comparación): Code refresca Cambios; Chat abre la sesión elegida. */
  onAdopted?: (info: AdoptedInfo) => void
  /** «Abrir la copia para resolverlo» (Code): abre la copia como proyecto. */
  onOpenWorktree?: (path: string) => void
}

const NO_ENTRIES: never[] = []

export function CompareView({ id, onAdopted, onOpenWorktree }: Props): React.JSX.Element | null {
  const m = useCompare((s) => s.manifests[id])
  const slice = useCompare((s) => s.slice)
  const busy = useCompare(useShallow((s) => s.busy))
  const failures = useCompare((s) => s.adoptFailures)
  const diffs = useCompare((s) => s.diffs)
  const error = useCompare((s) => s.errors[id])
  const allPermissions = useCompare(useShallow((s) => Object.values(s.permissions)))
  const providers = useProviders((s) => s.providers)
  const active = m ? isActiveManifest(m) : false
  const hasRate = !!m?.columns.some((c) => c.state === 'rateLimited' && c.retryAt !== null)
  const now = useNow(active || hasRate)
  if (!m) return null
  return (
    <CompareViewContent
      manifest={m}
      messages={slice.messages}
      busy={busy}
      failures={failures}
      diffs={diffs}
      error={error}
      permissions={allPermissions}
      providers={providers}
      now={now}
      onAdopted={onAdopted}
      onOpenWorktree={onOpenWorktree}
    />
  )
}

interface ContentProps {
  manifest: CompareManifest
  messages: Record<string, MessageEntry[]>
  busy: Record<string, string | undefined>
  failures: Record<string, AdoptFailure | undefined>
  diffs: Record<string, DiffState | undefined>
  error: string | undefined
  permissions: (PendingPermission & { index: number; compareId: string })[]
  providers: { id: string; models: Record<string, { name: string }> }[]
  now: number
  onAdopted?: (info: AdoptedInfo) => void
  onOpenWorktree?: (path: string) => void
}

/** Cuerpo de la vista (sin acceso al store: se prueba con props). */
export function CompareViewContent({
  manifest: m,
  messages,
  busy,
  failures,
  diffs,
  error,
  permissions: allPermissions,
  providers,
  now,
  onAdopted,
  onOpenWorktree
}: ContentProps): React.JSX.Element {
  const t = useT()
  const [drawer, setDrawer] = useState<{ index: number; trigger: HTMLElement } | null>(null)
  const active = isActiveManifest(m)
  const badges = useMemo(() => columnBadges(m.columns), [m])
  const nameOf = (c: CompareColumnManifest): string =>
    providers.find((p) => p.id === c.model.providerID)?.models[c.model.modelID]?.name ?? c.model.modelID
  const mode = m.mode
  const remaining = (c: CompareColumnManifest): number => m.columns.filter((x) => x.index !== c.index && !x.discarded).length

  const keep = async (c: CompareColumnManifest, force = false): Promise<void> => {
    if (!force) {
      const ok = await confirmDialog({
        title: t('compare.keep.confirmTitle'),
        message:
          mode === 'code' ? t('compare.keep.confirm', { count: remaining(c) }) : t('compare.keep.confirmChat', { count: remaining(c) }),
        confirmLabel: mode === 'code' ? t('compare.keep.apply') : t('compare.keepChat')
      })
      if (!ok) return
    }
    const out = await keepColumn(m.id, c.index, force)
    if (out.kind === 'ok') {
      if (mode === 'code') pushNotice('code', 'info', t('compare.keep.done'))
      onAdopted?.({ mode, column: c, files: out.files, promptPreview: m.promptPreview })
      return
    }
    if (out.kind === 'failed' && out.reason === 'dirty-overlap') {
      const again = await confirmDialog({
        title: t('compare.keep.confirmTitle'),
        message: t('compare.keep.dirty', { count: out.files.length }),
        confirmLabel: t('compare.keep.dirtyApply'),
        focusCancel: true
      })
      if (again) await keep(c, true)
    }
  }

  const discard = async (c: CompareColumnManifest): Promise<void> => {
    const ok = await confirmDialog({
      title: t('compare.discard.title'),
      message: t('compare.discard.confirm'),
      confirmLabel: t('compare.discard'),
      danger: true
    })
    if (ok) await discardColumn(m.id, c.index)
  }

  const close = async (): Promise<void> => {
    const needsConfirm = active || m.columns.some((c) => !c.discarded && !c.adopted)
    if (needsConfirm) {
      const ok = await confirmDialog({
        title: t('compare.close.title'),
        message: active ? t('compare.close.confirmRunning') : t('compare.close.confirm'),
        confirmLabel: t('compare.close'),
        danger: true
      })
      if (!ok) return
    }
    await closeCompare(m.id)
  }

  const copyPatch = async (c: CompareColumnManifest): Promise<void> => {
    const api = compareApi()
    if (!api) return
    try {
      const diff = await api.diff(m.id, c.index)
      await navigator.clipboard.writeText(diff.patch)
      pushNotice(mode, 'info', t('compare.keep.copied'))
    } catch {
      // el portapapeles puede no estar disponible: el parche sigue en «Ver cambios»
    }
  }

  const openDiff = (c: CompareColumnManifest, trigger: HTMLElement): void => {
    setDrawer({ index: c.index, trigger })
    void loadDiff(m.id, c.index)
  }

  const permissionsOf = (c: CompareColumnManifest): PendingPermission[] =>
    allPermissions.filter((p) => p.compareId === m.id && p.index === c.index)
  const drawerCol = drawer ? m.columns.find((c) => c.index === drawer.index) : undefined
  const globalBusy = busy[`${m.id}:*`]

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-testid="compare-view">
      <header className="drag flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 desk:pl-[calc(var(--header-inset,0px)+12px)]">
        <h2 className="shrink-0 font-display text-[14px] font-semibold desk:font-[family-name:var(--font-ui)] desk:font-medium">
          {t('compare.title')}
        </h2>
        <span className="shrink-0 text-[12px] text-subtle desk:text-meta">{t('compare.models', { count: m.columns.length })}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-subtle desk:text-meta" title={m.promptPreview}>
          {m.promptPreview}
        </span>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          {active && (
            <Button size="sm" variant="ghost" onClick={() => void cancelColumn(m.id)} disabled={globalBusy === 'cancel'}>
              {t('compare.cancelAll')}
            </Button>
          )}
          {isFinished(m) && (
            <Button
              size="sm"
              variant="ghost"
              title={t('compare.bench.hint')}
              onClick={() => void exportBench(m.id)}
              disabled={globalBusy === 'export'}
            >
              {t('compare.bench.save')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void close()} disabled={globalBusy === 'close'}>
            {t('compare.close')}
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="shrink-0 border-b border-border bg-inset px-4 py-1.5 text-[12.5px] text-danger">
          {error}
        </p>
      )}
      <div
        role="group"
        aria-label={t('compare.columns')}
        tabIndex={0}
        className="grid min-h-0 flex-1 auto-cols-[minmax(300px,1fr)] grid-flow-col divide-x divide-border overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset"
      >
        {m.columns.map((c) => (
          <CompareColumn
            key={c.index}
            manifest={m}
            column={c}
            mode={mode}
            modelName={nameOf(c)}
            entries={(c.sessionID && messages[c.sessionID]) || NO_ENTRIES}
            now={now}
            badges={badges.get(c.index) ?? []}
            permissions={permissionsOf(c)}
            busy={busy[colKey(m.id, c.index)]}
            failure={failures[colKey(m.id, c.index)]}
            onKeep={() => void keep(c)}
            onDiscard={() => void discard(c)}
            onCancel={() => void cancelColumn(m.id, c.index)}
            onRetry={() => void retryColumn(m.id, c.index)}
            onViewDiff={(trigger) => openDiff(c, trigger)}
            onReply={(p, reply) => void replyPermission(p, reply)}
            onOpenWorktree={c.worktree && onOpenWorktree ? () => onOpenWorktree(c.worktree!.path) : undefined}
            onCopyPatch={mode === 'code' ? () => void copyPatch(c) : undefined}
          />
        ))}
      </div>
      {drawer && drawerCol && (
        <DiffDrawer
          title={t('compare.diff.title', { model: nameOf(drawerCol) })}
          state={diffs[colKey(m.id, drawer.index)]}
          returnFocus={drawer.trigger}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}
