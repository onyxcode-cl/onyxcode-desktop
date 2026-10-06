/** Fábricas y cliente falso para las pruebas de «Comparar modelos» (sin Electron ni motor real). */
import { vi } from 'vitest'
import type { CompareColumnManifest, CompareManifest, CompareMetrics, CompareStartRequest } from '@shared/ipc-code'
import type { CompareApi } from './api'

export const NO_METRICS: CompareMetrics = {
  inputTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  costUsd: null,
  llmCalls: 0,
  durationMs: null
}

export function mkCol(index: number, over: Partial<CompareColumnManifest> = {}): CompareColumnManifest {
  return {
    index,
    model: { providerID: index === 2 ? 'opencode-go' : 'fake', modelID: `model-${index}` },
    sessionID: `ses_${index}`,
    worktree: { path: `/repo-wt/lazunox-compare-${index}`, branch: `lazunox-compare/abcd1234-${index}` },
    state: 'running',
    adopted: false,
    discarded: false,
    startedAt: 1_000,
    finishedAt: null,
    metrics: { ...NO_METRICS },
    error: null,
    retryAt: null,
    retried: false,
    stopUnconfirmed: false,
    interrupted: false,
    diff: null,
    ...over
  }
}

export function mkManifest(over: Partial<CompareManifest> = {}, cols?: CompareColumnManifest[]): CompareManifest {
  return {
    v: 1,
    id: '11111111-1111-4111-8111-111111111111',
    mode: 'code',
    cwd: '/repo',
    baseCommit: 'abc1234deadbeef',
    dirtyAtStart: false,
    createdAt: 1_000,
    promptPreview: 'haz que el botón sea azul',
    permissionMode: 'manual',
    pausedProviders: [],
    columns: cols ?? [mkCol(0), mkCol(1)],
    ...over
  }
}

export interface FakeCompare {
  api: CompareApi
  emit: (m: CompareManifest) => void
}

/** `window.api.code.compare` falso; `start` devuelve un manifiesto con una columna por modelo pedido. */
export function fakeCompare(over: Partial<CompareApi> = {}): FakeCompare {
  const listeners = new Set<(m: CompareManifest) => void>()
  const api: CompareApi = {
    list: vi.fn(async () => []),
    preflight: vi.fn(async () => ({
      repo: true,
      root: '/repo',
      head: 'abc1234deadbeef',
      shortHead: 'abc1234',
      clean: true,
      dirtyFiles: 0
    })),
    start: vi.fn(async (req: CompareStartRequest) =>
      mkManifest(
        { id: req.id, mode: req.mode, cwd: req.cwd ?? null },
        req.models.map((model, i) => mkCol(i, { model, state: 'queued', sessionID: null }))
      )
    ),
    cancel: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    diff: vi.fn(async () => ({ files: 1, additions: 2, deletions: 1, patch: 'diff --git a/a b/a\n', truncated: false })),
    adopt: vi.fn(async () => ({ ok: true as const, files: ['a.txt'] })),
    discard: vi.fn(async () => undefined),
    close: vi.fn(async () => ({ closed: true, kept: [] })),
    exportBench: vi.fn(async () => ({ path: '/tmp/x.json' })),
    onChanged: vi.fn((cb: (m: CompareManifest) => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    ...over
  }
  return { api, emit: (m) => listeners.forEach((l) => l(m)) }
}

/** Instala la API falsa en `window.api` (`platform` simulable: `remote` = celular). */
export function installApi(compare: CompareApi | null, platform = 'darwin'): void {
  const w = globalThis as unknown as { window: { api: Record<string, unknown> } }
  w.window.api = { ...w.window.api, platform, code: compare ? { compare } : undefined }
}
