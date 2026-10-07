/**
 * Guardia de la propagación de la bandera `tasksWin` (plan Parte B, W7): `main` la calcula una vez con `resolveTasksWin`,
 * la entrega al preload de la ventana principal y TODA consulta de capacidades del renderer la recibe. Una consulta sin banderas
 * dejaría Tareas oculta aunque estuviera encendida (o, peor, a medias). Estático: no ejecuta nada.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (rel: string): string => strip(readFileSync(join(SRC, rel), 'utf8'))

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

describe('propagación de tasksWin', () => {
  it('main/index.ts calcula la bandera con resolveTasksWin y la pasa a capsFor, al preload y a los handlers', () => {
    const s = read('main/index.ts')
    expect(s).toMatch(
      /resolveTasksWin\(\{[\s\S]*platform: process\.platform[\s\S]*optIn: process\.platform === 'win32' \? readTasksWinBetaConsent\(app\.getPath\('userData'\)\) : false[\s\S]*policy:/
    )
    expect(s).toMatch(/capsFor\(process\.platform, \{ tasksWin, remoteWin, computerWin \}\)/)
    expect(s).toMatch(
      /additionalArguments: capsFlagsToArgs\(\{ tasksWin: tasksWinOn, remoteWin: remoteWinOn, computerWin: computerWinOn \}\)/
    )
    expect(s).toMatch(
      /computer: caps\.computer,\s*tasksWin: tasksWinOn,\s*computerWin: computerWinOn,\s*winBackend: tasksWinOn \? await createWinBackend\(\) : undefined/
    )
    // El consentimiento beta lo lee main de su archivo; el ajuste legado del renderer no cuenta.
    expect(s).not.toMatch(/tasksWinBeta/)
    // La puerta de compilación y la variable de desarrollo viven solo en feature-flags.ts / tasks-win-flag.ts.
    expect(s).not.toMatch(/TASKS_WIN_BUILD|LAZUNOX_TASKS_WIN/)
  })

  it('la puerta de la beta: arrancar un servidor usa el propósito estricto `run`; solo la tarjeta de preparación pide `setup`', () => {
    // sandbox.ts (zona Seatbelt) no cambia: llama a selectBackend sin propósito, y por defecto es `run`.
    expect(read('main/tasks/sandbox.ts')).toMatch(/selectBackend\(platform, \{ tasksWin: options\.tasksWin, win: options\.winBackend \}\)/)
    expect(read('main/tasks/sandbox.ts')).not.toMatch(/purpose/)
    expect(read('main/ipc/tasks-sandbox-handlers.ts')).toMatch(/purpose: 'setup'/)
    expect(read('main/tasks/backends/index.ts')).toMatch(/win\.gate\(opts\.purpose \?\? 'run'\)/)
    // Nada de producción usa ya los informes del PC: `tasks-win-report.ts` queda archivado.
    const offenders: string[] = []
    for (const f of walk(SRC)) {
      if (/tasks-win-report\.ts$|__fixtures__/.test(f)) continue
      if (/tasks-win-report|windowsReportOk|gateProblems/.test(strip(readFileSync(f, 'utf8')))) offenders.push(relative(SRC, f))
    }
    expect(offenders).toEqual([])
  })

  it('el renderer nunca consulta capacidades sin las banderas', () => {
    const offenders: string[] = []
    for (const f of walk(join(SRC, 'renderer', 'src'))) {
      const s = strip(readFileSync(f, 'utf8'))
      // capsFor(currentPlatform()) / modeAvailable(x, currentPlatform()) / usableMode(x, currentPlatform()) a secas.
      if (
        /capsFor\(currentPlatform\(\)\)/.test(s) ||
        /(?:modeAvailable|usableMode)\([^()]*(?:\([^()]*\))?[^()]*currentPlatform\(\)\)/.test(s)
      ) {
        offenders.push(relative(SRC, f))
      }
    }
    expect(offenders).toEqual([])
  })

  it('platformCaps() del renderer usa currentFlags() (lo que el preload recibió de main)', () => {
    expect(read('renderer/src/lib/platform.ts')).toMatch(/capsFor\(currentPlatform\(\), currentFlags\(\)\)/)
    expect(read('preload/index.ts')).toMatch(/capsFlagsFromArgv\(process\.argv\)/)
  })

  it('los preloads secundarios (hash vigilado) no leen banderas', () => {
    for (const n of ['quick', 'overlay', 'pill', 'assist', 'browser-host']) {
      expect(read(`preload/${n}.ts`)).not.toMatch(/caps-argv|capsFlags|process\.argv/)
    }
  })
})
