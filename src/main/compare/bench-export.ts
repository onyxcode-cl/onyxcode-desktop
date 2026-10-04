/**
 * Lote JSON REDACTADO de una comparación, compatible con el formato de resultados v1 de agent-bench
 * (`RunResultSchema`/`ExperimentSchema`, `schemaVersion: "1"`): lo desconocido es `null`, nunca 0. No importa su código
 * ni zod: la forma se fija aquí y la comprueba `bench-export.test.ts` contra las claves del esquema.
 * Todo texto (prompt, diff, errores) pasa por `redactSecrets`.
 */
import { createHash, randomUUID } from 'node:crypto'
import { redactSecrets } from '@shared/ai-errors'
import type { CompareColumnManifest, CompareManifest } from '@shared/ipc-code'
import { COMPARE_LIMITS } from './limits'

export const BENCH_FORMAT = 'onyx-compare'
export const BENCH_VERSION = 1
export const BENCH_ENV_VERSION = 'onyx-export-1'

export type BenchOutcome = 'completed' | 'agent_error' | 'rate_limited' | 'cancelled'

export interface BenchEnv {
  os: string
  arch: string
  nodeVersion: string
  gitVersion: string | null
  cliVersion: string | null
  ncpu: number
  totalMemBytes: number
}

export interface BenchColumnExtra {
  /** Parche del worktree (bytes ya decodificados) o `null` si la copia ya no existe. */
  patch: string | null
  filesModified: string[] | null
}

export interface BenchInput {
  manifest: CompareManifest
  /** Texto completo del prompt (solo en memoria); si falta, se usa la vista previa. */
  prompt: string | null
  env: BenchEnv
  extras: ReadonlyMap<number, BenchColumnExtra>
  now?: () => number
  uuid?: () => string
}

const sha8 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 8)
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')

export function configurationId(col: Pick<CompareColumnManifest, 'model'>): string {
  const { providerID, modelID, variant } = col.model
  return `onyx-${slug(providerID)}-${slug(modelID)}${variant ? `-${slug(variant)}` : ''}`
}

export function benchOutcome(state: CompareColumnManifest['state']): BenchOutcome {
  switch (state) {
    case 'done':
      return 'completed'
    case 'error':
      return 'agent_error'
    case 'rateLimited':
      return 'rate_limited'
    default:
      return 'cancelled'
  }
}

const iso = (ms: number): string => new Date(ms).toISOString()
const sum = (vals: (number | null)[]): number | null =>
  vals.some((v) => v === null) ? null : vals.reduce<number>((a, v) => a + (v as number), 0)

export function buildBenchBatch(input: BenchInput): Record<string, unknown> {
  const { manifest: m, env } = input
  const now = (input.now ?? Date.now)()
  const uuid = input.uuid ?? randomUUID
  const id8 = m.id.replace(/-/g, '').slice(0, 8)
  const promptText = redactSecrets(input.prompt ?? m.promptPreview)
  const scenarioId = `adhoc-${sha8(input.prompt ?? m.promptPreview)}`
  const experimentId = `onyx-compare-${id8}`
  const cols = m.columns
  const configs = cols.map(configurationId)
  const costs = cols.map((c) => c.metrics.costUsd).filter((c): c is number => c !== null)
  const environment = {
    schemaVersion: '1',
    os: env.os,
    arch: env.arch,
    nodeVersion: env.nodeVersion,
    gitVersion: env.gitVersion,
    cliVersion: env.cliVersion,
    ncpu: env.ncpu,
    totalMemBytes: env.totalMemBytes,
    benchVersion: BENCH_ENV_VERSION,
    isolation: 'none'
  }

  const runs = cols.map((c) => {
    const x = input.extras.get(c.index)
    const started = c.startedAt ?? m.createdAt
    const finished = c.finishedAt ?? c.startedAt ?? now
    const mt = c.metrics
    const patch = x?.patch ? redactSecrets(x.patch) : null
    return {
      schemaVersion: '1',
      runId: uuid(),
      experimentId,
      scenarioId,
      configurationId: configurationId(c),
      runner: 'opencode',
      provider: c.model.providerID,
      model: c.model.modelID,
      cliVersion: env.cliVersion,
      features: { skills: [], subagents: [] },
      repetition: 0,
      seed: null,
      startedAt: iso(started),
      finishedAt: iso(Math.max(started, finished)),
      outcome: benchOutcome(c.state),
      success: null,
      telemetry: {
        schemaVersion: '1',
        inputTokens: mt.inputTokens,
        outputTokens: mt.outputTokens,
        cachedTokens: mt.cacheReadTokens,
        reasoningTokens: mt.reasoningTokens,
        totalTokens: sum([mt.inputTokens, mt.outputTokens]),
        llmCalls: mt.llmCalls > 0 ? mt.llmCalls : null,
        peakContext: null,
        costUsd: mt.costUsd,
        toolCalls: null,
        commands: null,
        steps: null,
        filesRead: null,
        filesModified: x?.filesModified ?? null,
        filesCreated: null,
        filesDeleted: null,
        extra: { onyx: { chosen: c.adopted, mode: m.mode } }
      },
      durationMs: mt.durationMs !== null ? Math.max(0, Math.round(mt.durationMs)) : Math.max(0, Math.round(finished - started)),
      evaluators: [],
      score: { correctness: null, quality: null, efficiency: null },
      orphans: null,
      gitDiff: patch === null ? null : patch.length > COMPARE_LIMITS.benchPatchMax ? patch.slice(0, COMPARE_LIMITS.benchPatchMax) : patch,
      error: c.error ? redactSecrets(c.error.message) : null,
      environment,
      configHash: null,
      caseHash: null
    }
  })

  return {
    format: BENCH_FORMAT,
    v: BENCH_VERSION,
    experiment: {
      schemaVersion: '1',
      id: experimentId,
      description: redactSecrets(m.promptPreview).slice(0, 200),
      scenarios: [scenarioId],
      configurations: [...new Set(configs)],
      repetitions: 1,
      seed: 1,
      budget: { maxCost: costs.length ? costs.reduce((a, b) => a + b, 0) : 0 },
      concurrency: 1
    },
    prompt: promptText,
    environment,
    runs
  }
}
