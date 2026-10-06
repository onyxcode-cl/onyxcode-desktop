import { describe, expect, it } from 'vitest'
import {
  evaluateReport,
  evaluateReportPair,
  gateProblems,
  ISOLATION_FILES,
  parseTasksWinReport,
  REQUIRED_ATTACK_IDS,
  type TasksWinReport
} from './tasks-win-report'
import { depsFor, H, okReport } from './__fixtures__/tasks-win-report.fixture'

const clone = (r: TasksWinReport): TasksWinReport => JSON.parse(JSON.stringify(r)) as TasksWinReport

describe('parseTasksWinReport', () => {
  it('acepta un informe completo y el de ensayo serializado', () => {
    expect(parseTasksWinReport(JSON.parse(JSON.stringify(okReport()))).ok).toBe(true)
  })
  it.each([null, 5, 'x', [], undefined])('rechaza lo que no es un objeto (%j)', (v) => {
    expect(parseTasksWinReport(v).ok).toBe(false)
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type M = Record<string, any>
  const mutate = (fn: (r: M) => void): ReturnType<typeof parseTasksWinReport> => {
    const r = clone(okReport()) as unknown as M
    fn(r)
    return parseTasksWinReport(r)
  }
  it.each<[string, (r: M) => void]>([
    ['schema 2', (r) => (r.schema = 2)],
    ['fecha rara', (r) => (r.generatedAt = 'ayer')],
    ['session', (r) => (r.session = 'admin')],
    ['integrity', (r) => (r.integrity = 'low')],
    ['status', (r) => (r.status = 'verde')],
    ['clave extra', (r) => (r.extra = 1)],
    ['falta results', (r) => delete r.results],
    ['hash corto', (r) => (r.build.hashes['src/main/tasks/ui-path.ts'] = 'abc')],
    ['hash en mayúsculas', (r) => (r.build.hashes['src/main/tasks/ui-path.ts'] = 'A'.repeat(64))],
    ['ruta con ..', (r) => (r.build.hashes['../x'] = H(1))],
    ['ruta absoluta', (r) => (r.build.hashes['/etc/passwd'] = H(1))],
    ['status de ataque', (r) => (r.results[0].status = 'ok')],
    ['criterio de ataque', (r) => (r.results[0].criterion = 'C')],
    ['id de ataque', (r) => (r.results[0].id = 'B1')],
    ['duración negativa', (r) => (r.results[0].durationMs = -1)],
    ['smbNew fraccionario', (r) => (r.baseline.smbNew = 0.5)],
    ['booleano como texto', (r) => (r.baseline.victimHashUnchanged = 'true')],
    ['landlockAbi', (r) => (r.host.landlockAbi = -1)],
    ['clave extra en un resultado', (r) => (r.results[1].secreto = 'sk-x')]
  ])('rechaza: %s', (_n, fn) => {
    expect(mutate(fn).ok).toBe(false)
  })
})

describe('evaluateReport / evaluateReportPair', () => {
  const pair = (): { elevated: TasksWinReport; normal: TasksWinReport } => ({ elevated: okReport('elevated'), normal: okReport('normal') })

  it('un informe en verde de las dos sesiones, con hashes y pins al día, no tiene problemas', () => {
    expect(evaluateReportPair(pair(), depsFor())).toEqual([])
  })
  it('cualquier estado que no sea green bloquea', () => {
    for (const s of ['red', 'dirty'] as const) {
      const p = pair()
      p.normal.status = s
      expect(evaluateReportPair(p, depsFor()).join('\n')).toContain('no green')
    }
  })
  it('la sesión «normal» con integridad alta invalida el informe; y la ranura no se puede intercambiar', () => {
    const p = pair()
    p.normal.integrity = 'high'
    expect(evaluateReportPair(p, depsFor()).join('\n')).toContain('exige medium')
    expect(evaluateReport(okReport('normal'), 'elevated', depsFor()).join('\n')).toContain('trae un informe de la sesión normal')
  })
  it('línea base sucia: distros, víctima, SMB', () => {
    const r = okReport()
    r.baseline.otherDistrosUnchanged = false
    r.baseline.victimHashUnchanged = false
    r.baseline.smbNew = 2
    const m = evaluateReport(r, 'elevated', depsFor()).join('\n')
    expect(m).toContain('otras distros')
    expect(m).toContain('víctima')
    expect(m).toContain('SMB')
  })
  it.each(['fail', 'blocked', 'skip'] as const)('un ataque B en %s bloquea', (status) => {
    const r = okReport()
    r.results.find((x) => x.id === 'A7')!.status = status
    expect(evaluateReport(r, 'elevated', depsFor()).join('\n')).toContain('A7 [B]')
  })
  it('falta un ataque: bloquea (cubre A1–A20, A6b y A7b)', () => {
    for (const id of REQUIRED_ATTACK_IDS) {
      const r = okReport()
      r.results = r.results.filter((x) => x.id !== id)
      expect(evaluateReport(r, 'elevated', depsFor()).join('\n')).toContain(`${id}: falta`)
    }
  })
  it('un fallo escondido entre varios casos del mismo ataque se ve', () => {
    const r = okReport()
    r.results.push({
      id: 'A9',
      case: 'cat /proc/1/environ',
      criterion: 'B',
      status: 'fail',
      evidence: 'token',
      skipReason: '',
      durationMs: 1
    })
    expect(evaluateReport(r, 'elevated', depsFor()).join('\n')).toContain('A9 [B] fail')
  })
  it('criterio I: cualquier estado vale, pero el ataque debe estar', () => {
    const r = okReport()
    const a = r.results.find((x) => x.id === 'A17')!
    a.criterion = 'I'
    a.status = 'fail'
    expect(evaluateReport(r, 'elevated', depsFor())).toEqual([])
  })
  describe('A3 (symlink NTFS sin Modo de desarrollador)', () => {
    it('skip con motivo en la sesión normal pasa si la elevada dio pass', () => {
      const p = pair()
      Object.assign(
        p.normal.results.find((x) => x.id === 'A3')!,
        { status: 'skip', skipReason: 'sin Modo de desarrollador' }
      )
      expect(evaluateReportPair(p, depsFor())).toEqual([])
    })
    it('skip sin motivo bloquea', () => {
      const p = pair()
      Object.assign(
        p.normal.results.find((x) => x.id === 'A3')!,
        { status: 'skip', skipReason: '  ' }
      )
      expect(evaluateReportPair(p, depsFor()).join('\n')).toContain('skip sin motivo')
    })
    it('skip en las dos sesiones: ningún pass', () => {
      const p = pair()
      for (const r of [p.elevated, p.normal])
        Object.assign(
          r.results.find((x) => x.id === 'A3')!,
          { status: 'skip', skipReason: 'm' }
        )
      expect(evaluateReportPair(p, depsFor()).join('\n')).toContain('A3 no dio pass')
    })
    it('el skip con motivo NO se acepta en otros ataques', () => {
      const r = okReport()
      Object.assign(
        r.results.find((x) => x.id === 'A2')!,
        { status: 'skip', skipReason: 'por pereza' }
      )
      expect(evaluateReport(r, 'elevated', depsFor()).join('\n')).toContain('A2 [B] skip')
    })
  })
  describe('frescura por contenido', () => {
    it('cambiar un byte de un archivo de aislamiento invalida el informe', () => {
      for (const f of ISOLATION_FILES) {
        const d = depsFor({ hashOf: (x) => (x === f ? H(777) : depsFor().hashOf(x)) })
        expect(evaluateReport(okReport(), 'elevated', d).join('\n')).toContain(`${f}: cambió`)
      }
    })
    it('un archivo de aislamiento sin hash en el informe, o borrado, bloquea', () => {
      const r = okReport()
      delete r.build.hashes['resources/wsl/launcher.py']
      expect(evaluateReport(r, 'elevated', depsFor()).join('\n')).toContain('no incluye resources/wsl/launcher.py')
      const d = depsFor({ hashOf: () => null })
      expect(evaluateReport(okReport(), 'elevated', d).join('\n')).toContain('ya no existe')
    })
    it('rootfsSha y opencodeVersion deben coincidir con el pin; sin pin no se puede comprobar', () => {
      expect(
        evaluateReport(okReport(), 'elevated', depsFor({ pin: { rootfsSha: H(1), opencodeVersion: '1.18.33' } })).join('\n')
      ).toContain('rootfsSha')
      expect(
        evaluateReport(okReport(), 'elevated', depsFor({ pin: { rootfsSha: H(900), opencodeVersion: '9.9.9' } })).join('\n')
      ).toContain('opencodeVersion')
      expect(evaluateReport(okReport(), 'elevated', depsFor({ pin: { rootfsSha: null, opencodeVersion: null } })).join('\n')).toMatch(
        /no hay pin de la imagen/
      )
    })
    it('antigüedad respecto al último cambio del aislamiento y fecha futura', () => {
      const old = depsFor({ lastTouchedAt: new Date('2026-12-20T00:00:00Z') })
      expect(evaluateReport(okReport(), 'elevated', old).join('\n')).toContain('días más antiguo')
      const fine = depsFor({ lastTouchedAt: new Date('2026-10-20T00:00:00Z') })
      expect(evaluateReport(okReport(), 'elevated', fine)).toEqual([])
      const fut = okReport()
      fut.generatedAt = '2030-01-01T00:00:00Z'
      expect(evaluateReport(fut, 'elevated', depsFor()).join('\n')).toContain('futuro')
    })
  })
})

describe('gateProblems (la puerta de la guardia, con la bandera inyectada)', () => {
  const both = { elevated: okReport('elevated'), normal: okReport('normal') }
  it('bandera apagada: sin informes no hay nada que validar', () => {
    expect(gateProblems(false, {}, depsFor())).toEqual([])
  })
  it('bandera apagada: un informe presente pero mal formado igualmente se denuncia', () => {
    expect(gateProblems(false, { elevated: { schema: 9 } }, depsFor()).join('\n')).toContain('elevated')
  })
  it('bandera apagada: un informe rojo de ensayo es válido (solo se exige esquema)', () => {
    const r = okReport('elevated')
    r.status = 'red'
    expect(gateProblems(false, { elevated: r }, depsFor())).toEqual([])
  })
  it('bandera ENCENDIDA sin informes: bloquea', () => {
    const m = gateProblems(true, {}, depsFor()).join('\n')
    expect(m).toContain('falta el informe de la sesión elevated')
    expect(m).toContain('falta el informe de la sesión normal')
  })
  it('bandera encendida con un solo informe: bloquea', () => {
    expect(gateProblems(true, { elevated: both.elevated }, depsFor()).join('\n')).toContain('normal')
  })
  it('bandera encendida con los dos en verde: pasa', () => {
    expect(gateProblems(true, JSON.parse(JSON.stringify(both)), depsFor())).toEqual([])
  })
  it('bandera encendida, informes en verde pero un byte de launcher.py cambió: bloquea', () => {
    const d = depsFor({ hashOf: (f) => (f === 'resources/wsl/launcher.py' ? H(4242) : depsFor().hashOf(f)) })
    expect(gateProblems(true, JSON.parse(JSON.stringify(both)), d).join('\n')).toContain('launcher.py')
  })
  it('bandera encendida y un informe con esquema roto: bloquea', () => {
    expect(gateProblems(true, { elevated: both.elevated, normal: { ...both.normal, extra: 1 } }, depsFor()).join('\n')).toContain('normal')
  })
})
