import { describe, expect, it } from 'vitest'
import type { CompareColumnManifest, CompareManifest } from '@shared/ipc-code'
import { buildBenchBatch, configurationId, type BenchEnv } from './bench-export'
import { emptyMetrics } from './metrics'

// Claves de RunResultSchema / TelemetrySchema / EnvironmentSchema / ExperimentSchema v1 de agent-bench
// (copiadas de tools/agent-bench/src/core/schemas.ts de la rama feat/agent-bench; sin importar su código).
const RUN_KEYS = [
  'schemaVersion',
  'runId',
  'experimentId',
  'scenarioId',
  'configurationId',
  'runner',
  'provider',
  'model',
  'cliVersion',
  'features',
  'repetition',
  'seed',
  'startedAt',
  'finishedAt',
  'outcome',
  'success',
  'telemetry',
  'durationMs',
  'evaluators',
  'score',
  'orphans',
  'gitDiff',
  'error',
  'environment',
  'configHash',
  'caseHash'
]
const TELEMETRY_KEYS = [
  'schemaVersion',
  'inputTokens',
  'outputTokens',
  'cachedTokens',
  'reasoningTokens',
  'totalTokens',
  'llmCalls',
  'peakContext',
  'costUsd',
  'toolCalls',
  'commands',
  'steps',
  'filesRead',
  'filesModified',
  'filesCreated',
  'filesDeleted',
  'extra'
]
const ENV_KEYS = [
  'schemaVersion',
  'os',
  'arch',
  'nodeVersion',
  'gitVersion',
  'cliVersion',
  'ncpu',
  'totalMemBytes',
  'benchVersion',
  'isolation'
]
const EXPERIMENT_KEYS = [
  'schemaVersion',
  'id',
  'description',
  'scenarios',
  'configurations',
  'repetitions',
  'seed',
  'budget',
  'concurrency'
]
const OUTCOMES = ['completed', 'agent_error', 'timeout', 'hung', 'rate_limited', 'infra_error', 'cancelled']

const env: BenchEnv = {
  os: 'darwin',
  arch: 'arm64',
  nodeVersion: 'v22.0.0',
  gitVersion: '2.45.0',
  cliVersion: '1.18.32',
  ncpu: 8,
  totalMemBytes: 16e9
}
const col = (index: number, over: Partial<CompareColumnManifest> = {}): CompareColumnManifest => ({
  index,
  model: { providerID: 'opencode-go', modelID: `Model.${index}`, ...(index === 1 ? { variant: 'high' } : {}) },
  sessionID: `ses_${index}`,
  worktree: null,
  state: 'done',
  adopted: index === 0,
  discarded: false,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_050_000,
  metrics: { ...emptyMetrics(), inputTokens: 100, outputTokens: 50, costUsd: 0.02, llmCalls: 2, durationMs: 48_000 },
  error: null,
  retryAt: null,
  retried: false,
  stopUnconfirmed: false,
  interrupted: false,
  diff: null,
  ...over
})
const manifest = (cols: CompareColumnManifest[]): CompareManifest => ({
  v: 1,
  id: '0a1b2c3d-1111-4222-8333-444455556666',
  mode: 'code',
  cwd: '/p',
  baseCommit: 'a'.repeat(40),
  dirtyAtStart: false,
  createdAt: 1_700_000_000_000,
  promptPreview: 'arregla el bug con sk-abcdefghijklmnopqrstuvwxyz123456',
  permissionMode: 'auto',
  pausedProviders: [],
  columns: cols
})

describe('exportación de un lote para el banco', () => {
  it('cada run tiene exactamente las claves de RunResultSchema v1', () => {
    const b = buildBenchBatch({
      manifest: manifest([col(0), col(1)]),
      prompt: 'texto',
      env,
      extras: new Map(),
      now: () => 1_700_000_100_000
    }) as {
      format: string
      v: number
      experiment: Record<string, unknown>
      runs: Record<string, unknown>[]
    }
    expect(b.format).toBe('onyx-compare')
    expect(b.v).toBe(1)
    expect(Object.keys(b.experiment).sort()).toEqual([...EXPERIMENT_KEYS].sort())
    expect(b.experiment.id).toBe('onyx-compare-0a1b2c3d')
    expect(b.experiment.configurations).toEqual(['onyx-opencode-go-model.0', 'onyx-opencode-go-model.1-high'])
    expect(b.runs).toHaveLength(2)
    for (const r of b.runs) {
      expect(Object.keys(r).sort()).toEqual([...RUN_KEYS].sort())
      expect(Object.keys(r.telemetry as object).sort()).toEqual([...TELEMETRY_KEYS].sort())
      expect(Object.keys(r.environment as object).sort()).toEqual([...ENV_KEYS].sort())
      expect(OUTCOMES).toContain(r.outcome)
      expect(r.success).toBeNull()
      expect(r.configurationId).toMatch(/^[a-z0-9][a-z0-9._-]*$/)
    }
    expect((b.runs[0].telemetry as { extra: unknown }).extra).toEqual({ onyx: { chosen: true, mode: 'code' } })
    expect((b.runs[1].telemetry as { extra: unknown }).extra).toEqual({ onyx: { chosen: false, mode: 'code' } })
  })

  it('lo que no se sabe es null, nunca 0', () => {
    const c = col(0, { state: 'cancelled', metrics: emptyMetrics() })
    const b = buildBenchBatch({ manifest: manifest([c, col(1)]), prompt: null, env, extras: new Map() }) as {
      runs: { telemetry: Record<string, unknown>; outcome: string }[]
      experiment: { budget: { maxCost: number } }
    }
    const t = b.runs[0].telemetry
    expect(t.costUsd).toBeNull()
    expect(t.inputTokens).toBeNull()
    expect(t.totalTokens).toBeNull()
    expect(t.llmCalls).toBeNull()
    expect(t.filesModified).toBeNull()
    expect(b.runs[0].outcome).toBe('cancelled')
    expect(b.experiment.budget.maxCost).toBeCloseTo(0.02)
  })

  it('mapea los estados a los resultados de agent-bench', () => {
    const states = ['done', 'error', 'rateLimited', 'cancelled'] as const
    const b = buildBenchBatch({ manifest: manifest(states.map((s, i) => col(i, { state: s }))), prompt: 'x', env, extras: new Map() }) as {
      runs: { outcome: string }[]
    }
    expect(b.runs.map((r) => r.outcome)).toEqual(['completed', 'agent_error', 'rate_limited', 'cancelled'])
  })

  it('redacta claves del prompt, del diff y de los errores; el diff se recorta a 200 KB', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz123456'
    const extras = new Map([[0, { patch: `+token ${key}\n` + 'x'.repeat(300 * 1024), filesModified: ['a.ts'] }]])
    const c = col(0, { state: 'error', error: { kind: 'unknown', message: `falló con ${key}` } })
    const b = buildBenchBatch({ manifest: manifest([c, col(1)]), prompt: `usa ${key} por favor`, env, extras }) as {
      prompt: string
      runs: { gitDiff: string | null; error: string | null }[]
    }
    const all = JSON.stringify(b)
    expect(all).not.toContain(key)
    expect(b.prompt).toContain('usa ')
    expect(b.runs[0].gitDiff!.length).toBeLessThanOrEqual(200 * 1024)
    expect(b.runs[1].gitDiff).toBeNull()
    expect(b.runs[0].error).not.toContain(key)
  })

  it('los ids de configuración son válidos para el esquema', () => {
    expect(configurationId({ model: { providerID: 'Open Code', modelID: 'GPT 5/Mini', variant: 'Hi!' } })).toBe(
      'onyx-open-code-gpt-5-mini-hi'
    )
  })
})
