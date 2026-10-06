/**
 * Informe de la batería de ataques de Tareas en Windows (`report.json`, esquema 1) y su evaluación. PURO: sin disco,
 * sin red, sin Electron. Lo escribe `scripts/win/tasks-attack.ps1` en el PC de pruebas; lo lee
 * `tasks-win-report.guard.test.ts` en `npm test` para impedir `TASKS_WIN_BUILD = true` sin un informe en verde,
 * de las DOS sesiones (elevada y normal) y cuyos hashes de código coincidan con el código actual.
 *
 * Criterios (siempre la lectura más estricta del plan):
 *  - Cada sesión debe traer TODOS los ataques de `REQUIRED_ATTACK_IDS`; uno que falte cuenta como fallo.
 *  - Criterio `B` (bloquea la activación): solo `pass`. `skip` únicamente en A3 (symlink NTFS sin Modo de
 *    desarrollador), con motivo escrito, y A3 debe dar `pass` en al menos una de las dos sesiones.
 *    `fail`, `blocked` y `skip` sin motivo bloquean. Criterio `I` (informativo): cualquier estado, pero presente.
 *  - `status: "green"`, integridad `high` (elevada) / `medium` (normal), línea base limpia.
 *  - Los hashes de `ISOLATION_FILES` deben estar TODOS y coincidir con los actuales (frescura por contenido).
 */

export const REPORT_SCHEMA = 1

/** Ataques que cada sesión debe cubrir (A6b y A7b son los cierres de A6 y A7). */
export const REQUIRED_ATTACK_IDS = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A6b',
  'A7',
  'A7b',
  'A8',
  'A9',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A15',
  'A16',
  'A17',
  'A18',
  'A19',
  'A20'
] as const

/** Archivos que definen el aislamiento: si cambian, el informe deja de valer y hay que repetir la batería. */
export const ISOLATION_FILES = [
  'src/main/tasks/backends/wsl-spec.ts',
  'src/main/tasks/backends/wsl-paths.ts',
  'src/main/tasks/backends/wsl.ts',
  'src/main/tasks/backends/wsl-bridge-host.ts',
  'src/main/tasks/backends/bridge-protocol.ts',
  'src/main/tasks/ui-path.ts',
  'src/main/tasks/folder-policy.ts',
  'src/main/tasks/folder-policy-win.ts',
  'src/main/tasks/win-drives.ts',
  'src/main/tasks/sandbox.ts',
  'src/main/tasks/proxy.ts',
  'src/main/tasks/proxy-policy.ts',
  'src/main/tasks/provider-egress.ts',
  'src/shared/wsl-paths.ts',
  'src/shared/tasks-path-map.ts',
  'resources/wsl/launcher.py',
  'resources/wsl/landlock.py',
  'resources/wsl/mux.py',
  'resources/wsl/protocol.py',
  'resources/wsl/wsl.conf'
] as const

export type AttackStatus = 'pass' | 'fail' | 'skip' | 'blocked'

export interface AttackResult {
  id: string
  case: string
  criterion: 'B' | 'I'
  status: AttackStatus
  evidence: string
  skipReason: string
  durationMs: number
}

export interface TasksWinReport {
  schema: 1
  generatedAt: string
  session: 'elevated' | 'normal'
  integrity: 'high' | 'medium'
  host: { windows: string; wslVersion: string; kernel: string; landlockAbi: number }
  build: { gitSha: string; rootfsSha: string; payloadSha: string; opencodeVersion: string; hashes: Record<string, string> }
  results: AttackResult[]
  baseline: {
    processesBefore: string[]
    processesAfter: string[]
    otherDistrosUnchanged: boolean
    victimHashUnchanged: boolean
    smbNew: number
  }
  status: 'green' | 'red' | 'dirty'
  summary: Record<string, Record<string, number>>
}

export type ParseResult = { ok: true; report: TasksWinReport } | { ok: false; errors: string[] }

const SHA256 = /^[0-9a-f]{64}$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Parser ESTRICTO: ningún campo se corrige ni se rellena; claves de más o de menos son error. */
export function parseTasksWinReport(raw: unknown): ParseResult {
  const errors: string[] = []
  const err = (m: string): void => void errors.push(m)
  if (!isObj(raw)) return { ok: false, errors: ['el informe no es un objeto'] }
  const exact = (o: Record<string, unknown>, keys: string[], where: string): void => {
    for (const k of keys) if (!(k in o)) err(`${where}: falta «${k}»`)
    for (const k of Object.keys(o)) if (!keys.includes(k)) err(`${where}: clave inesperada «${k}»`)
  }
  exact(raw, ['schema', 'generatedAt', 'session', 'integrity', 'host', 'build', 'results', 'baseline', 'status', 'summary'], 'informe')
  if (raw.schema !== REPORT_SCHEMA) err(`schema debe ser ${REPORT_SCHEMA}`)
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt)) || !/^\d{4}-\d\d-\d\dT/.test(raw.generatedAt)) {
    err('generatedAt no es una fecha ISO')
  }
  if (raw.session !== 'elevated' && raw.session !== 'normal') err('session debe ser elevated o normal')
  if (raw.integrity !== 'high' && raw.integrity !== 'medium') err('integrity debe ser high o medium')
  if (raw.status !== 'green' && raw.status !== 'red' && raw.status !== 'dirty') err('status debe ser green, red o dirty')

  const host = raw.host
  if (!isObj(host)) err('host no es un objeto')
  else {
    exact(host, ['windows', 'wslVersion', 'kernel', 'landlockAbi'], 'host')
    for (const k of ['windows', 'wslVersion', 'kernel']) if (typeof host[k] !== 'string') err(`host.${k} no es texto`)
    if (typeof host.landlockAbi !== 'number' || !Number.isInteger(host.landlockAbi) || host.landlockAbi < 0)
      err('host.landlockAbi inválido')
  }
  const build = raw.build
  if (!isObj(build)) err('build no es un objeto')
  else {
    exact(build, ['gitSha', 'rootfsSha', 'payloadSha', 'opencodeVersion', 'hashes'], 'build')
    for (const k of ['gitSha', 'rootfsSha', 'payloadSha', 'opencodeVersion'])
      if (typeof build[k] !== 'string') err(`build.${k} no es texto`)
    if (!isObj(build.hashes)) err('build.hashes no es un objeto')
    else {
      for (const [f, h] of Object.entries(build.hashes)) {
        if (typeof h !== 'string' || !SHA256.test(h)) err(`build.hashes[${f}] no es un sha256 en minúsculas`)
        if (/^[\\/]|\.\.|\\/.test(f)) err(`build.hashes: ruta no relativa o con «..»: ${f}`)
      }
    }
  }
  const results: AttackResult[] = []
  if (!Array.isArray(raw.results)) err('results no es una lista')
  else {
    raw.results.forEach((r, i) => {
      if (!isObj(r)) return err(`results[${i}] no es un objeto`)
      exact(r, ['id', 'case', 'criterion', 'status', 'evidence', 'skipReason', 'durationMs'], `results[${i}]`)
      if (typeof r.id !== 'string' || !/^A\d{1,2}b?$/.test(r.id)) err(`results[${i}].id inválido`)
      for (const k of ['case', 'evidence', 'skipReason']) if (typeof r[k] !== 'string') err(`results[${i}].${k} no es texto`)
      if (r.criterion !== 'B' && r.criterion !== 'I') err(`results[${i}].criterion debe ser B o I`)
      if (!['pass', 'fail', 'skip', 'blocked'].includes(r.status as string)) err(`results[${i}].status inválido`)
      if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs) || r.durationMs < 0) err(`results[${i}].durationMs inválido`)
      results.push(r as unknown as AttackResult)
    })
  }
  const b = raw.baseline
  if (!isObj(b)) err('baseline no es un objeto')
  else {
    exact(b, ['processesBefore', 'processesAfter', 'otherDistrosUnchanged', 'victimHashUnchanged', 'smbNew'], 'baseline')
    for (const k of ['processesBefore', 'processesAfter']) {
      if (!Array.isArray(b[k]) || !(b[k] as unknown[]).every((x) => typeof x === 'string')) err(`baseline.${k} debe ser una lista de texto`)
    }
    for (const k of ['otherDistrosUnchanged', 'victimHashUnchanged']) if (typeof b[k] !== 'boolean') err(`baseline.${k} no es booleano`)
    if (typeof b.smbNew !== 'number' || !Number.isInteger(b.smbNew) || b.smbNew < 0) err('baseline.smbNew inválido')
  }
  if (!isObj(raw.summary)) err('summary no es un objeto')
  return errors.length ? { ok: false, errors } : { ok: true, report: raw as unknown as TasksWinReport }
}

export interface EvaluateDeps {
  /** sha256 actual (hex) del archivo relativo a la raíz del repo, o `null` si no existe. */
  hashOf(relPath: string): string | null
  /** `rootfsSha` y versión de OpenCode fijados en el repo (`null` = no hay pin: no se puede comprobar). */
  pin: { rootfsSha: string | null; opencodeVersion: string | null }
  /** Fecha del último commit que tocó los archivos de aislamiento (solo si hay git). */
  lastTouchedAt?: Date | null
  now?: Date
}

export const MAX_REPORT_AGE_DAYS = 60

/** Problemas de UN informe (lista vacía = válido). `slot` es la sesión que se esperaba en esa ranura. */
export function evaluateReport(r: TasksWinReport, slot: 'elevated' | 'normal', deps: EvaluateDeps): string[] {
  const p: string[] = []
  if (r.session !== slot) p.push(`la ranura ${slot} trae un informe de la sesión ${r.session}`)
  if (r.status !== 'green') p.push(`status «${r.status}», no green`)
  const wantIntegrity = slot === 'elevated' ? 'high' : 'medium'
  if (r.integrity !== wantIntegrity) p.push(`integridad ${r.integrity}; la sesión ${slot} exige ${wantIntegrity}`)
  if (!r.baseline.otherDistrosUnchanged) p.push('otras distros cambiaron')
  if (!r.baseline.victimHashUnchanged) p.push('el hash de la víctima cambió')
  if (r.baseline.smbNew !== 0) p.push(`${r.baseline.smbNew} conexiones SMB nuevas`)

  const byId = new Map<string, AttackResult[]>()
  for (const x of r.results) byId.set(x.id, [...(byId.get(x.id) ?? []), x])
  for (const id of REQUIRED_ATTACK_IDS) {
    const list = byId.get(id)
    if (!list) {
      p.push(`${id}: falta en el informe`)
      continue
    }
    for (const x of list) {
      if (x.criterion === 'I') continue
      if (x.status === 'pass') continue
      if (x.status === 'skip' && id === 'A3' && x.skipReason.trim().length > 0) continue
      p.push(`${id} [B] ${x.status}${x.status === 'skip' && !x.skipReason.trim() ? ' sin motivo' : ''}: ${x.case}`)
    }
  }
  for (const [id, list] of byId) {
    if (id === 'A3' && !list.some((x) => x.criterion === 'B')) p.push('A3 debe llevar criterio B')
  }

  // Frescura por contenido: TODOS los archivos de aislamiento, con el hash actual.
  for (const f of ISOLATION_FILES) {
    const want = r.build.hashes[f]
    if (!want) {
      p.push(`build.hashes no incluye ${f}`)
      continue
    }
    const now = deps.hashOf(f)
    if (now === null) p.push(`${f}: ya no existe`)
    else if (now !== want) p.push(`${f}: cambió después del informe (hay que repetir la batería)`)
  }
  for (const f of Object.keys(r.build.hashes)) {
    if (!(ISOLATION_FILES as readonly string[]).includes(f) && deps.hashOf(f) !== r.build.hashes[f]) p.push(`${f}: hash obsoleto`)
  }
  if (deps.pin.rootfsSha === null) p.push('no hay pin de la imagen base (wsl-rootfs): no se puede comprobar rootfsSha')
  else if (r.build.rootfsSha !== deps.pin.rootfsSha) p.push('rootfsSha no coincide con el pin')
  if (deps.pin.opencodeVersion === null) p.push('no hay pin de OpenCode')
  else if (r.build.opencodeVersion !== deps.pin.opencodeVersion) p.push('opencodeVersion no coincide con el pin')

  const gen = Date.parse(r.generatedAt)
  const now = (deps.now ?? new Date()).getTime()
  if (gen > now + 24 * 3600_000) p.push('generatedAt está en el futuro')
  if (deps.lastTouchedAt) {
    const age = (deps.lastTouchedAt.getTime() - gen) / 86_400_000
    if (age > MAX_REPORT_AGE_DAYS)
      p.push(`el informe es ${Math.floor(age)} días más antiguo que el último cambio del aislamiento (máx. ${MAX_REPORT_AGE_DAYS})`)
  }
  return p
}

/** Evaluación conjunta: cada sesión por separado y la regla cruzada de A3 (al menos un `pass` entre las dos). */
export function evaluateReportPair(pair: { elevated: TasksWinReport; normal: TasksWinReport }, deps: EvaluateDeps): string[] {
  const p = [
    ...evaluateReport(pair.elevated, 'elevated', deps).map((m) => `elevated: ${m}`),
    ...evaluateReport(pair.normal, 'normal', deps).map((m) => `normal: ${m}`)
  ]
  const a3pass = [pair.elevated, pair.normal].some((r) =>
    r.results.some((x) => x.id === 'A3' && x.criterion === 'B' && x.status === 'pass')
  )
  if (!a3pass) p.push('A3 no dio pass en ninguna de las dos sesiones')
  return p
}

/**
 * Puerta de la guardia: con la bandera apagada solo exige que los informes que existan cumplan el esquema; con la
 * bandera ENCENDIDA exige ambos informes, en verde, al día por contenido y con las reglas cruzadas.
 * `reports` son los JSON ya leídos (ausente = no existe el archivo).
 */
export function gateProblems(build: boolean, reports: { elevated?: unknown; normal?: unknown }, deps: EvaluateDeps): string[] {
  const out: string[] = []
  const parsed: { elevated?: TasksWinReport; normal?: TasksWinReport } = {}
  for (const slot of ['elevated', 'normal'] as const) {
    const raw = reports[slot]
    if (raw === undefined) {
      if (build) out.push(`falta el informe de la sesión ${slot}`)
      continue
    }
    const r = parseTasksWinReport(raw)
    if (!r.ok) out.push(...r.errors.map((e) => `${slot}: ${e}`))
    else parsed[slot] = r.report
  }
  if (build && parsed.elevated && parsed.normal && out.length === 0) {
    out.push(...evaluateReportPair({ elevated: parsed.elevated, normal: parsed.normal }, deps))
  }
  return out
}
