/** Doble de un informe en verde y de las dependencias de evaluación (solo para pruebas). */
import { ISOLATION_FILES, REQUIRED_ATTACK_IDS, type AttackResult, type EvaluateDeps, type TasksWinReport } from '../tasks-win-report'

export const H = (n: number): string => n.toString(16).padStart(64, '0')

export function okReport(session: 'elevated' | 'normal' = 'elevated'): TasksWinReport {
  return {
    schema: 1,
    generatedAt: '2026-10-01T10:00:00Z',
    session,
    integrity: session === 'elevated' ? 'high' : 'medium',
    host: { windows: '10.0.26100', wslVersion: '2.6.1', kernel: '6.6.87', landlockAbi: 3 },
    build: {
      gitSha: 'abc',
      rootfsSha: H(900),
      payloadSha: H(901),
      opencodeVersion: '1.18.33',
      hashes: Object.fromEntries(ISOLATION_FILES.map((f, i) => [f, H(i + 1)]))
    },
    results: REQUIRED_ATTACK_IDS.map((id): AttackResult => ({
      id,
      case: `caso ${id}`,
      criterion: 'B',
      status: 'pass',
      evidence: 'ENOENT',
      skipReason: '',
      durationMs: 5
    })),
    baseline: { processesBefore: [], processesAfter: [], otherDistrosUnchanged: true, victimHashUnchanged: true, smbNew: 0 },
    status: 'green',
    summary: { B: { pass: REQUIRED_ATTACK_IDS.length } }
  }
}

export const depsFor = (over: Partial<EvaluateDeps> = {}): EvaluateDeps => ({
  hashOf: (f) => {
    const i = (ISOLATION_FILES as readonly string[]).indexOf(f)
    return i >= 0 ? H(i + 1) : null
  },
  pin: { rootfsSha: H(900), opencodeVersion: '1.18.33' },
  now: new Date('2026-10-06T00:00:00Z'),
  ...over
})
