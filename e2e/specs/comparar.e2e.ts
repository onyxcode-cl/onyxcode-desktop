// «Comparar modelos lado a lado» (F8-B78): interfaz con Electron real + OpenCode falso. Escrita sin ejecutar en la pasada de la
// interfaz (el dueño tiene el Llavero); la verificación final la hace el dueño.
//
// Apoyo del OpenCode falso (`e2e/fake-opencode/server.mjs`, F8-B82): `forModel: 'proveedor/modelo'` en `POST /__e2e/script` (el guion
// solo lo toma el `prompt_async` cuyo `body.model` coincide), `opencode-go/fake-go-model` en el catálogo y conectado, y el paso
// `{ type: 'error', preset: 'quota' }` (429 «token rate limit exceeded», que `friendlyError` clasifica como `quota`). El main de
// comparar no llama a `POST /instance/dispose` (el falso lo acepta igualmente), así que aquí no se exige.
//
// Windows: los bloques de Code usan `git worktree` bajo `~` y los ganchos del harness en dev (`describe.skipIf(IS_WIN)`); el bloque
// de Chat sí corre. Por eso la spec NO va entera en `e2e/win-skip.json` (esa lista es para specs enteras fuera de la v1).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startApp, MODE, type E2EApp } from '../lib/launch'
import { useApp } from '../lib/harness'
import { IS_WIN } from '../lib/proc'
import { shot } from '../lib/shots'
import { storeState } from '../lib/stores'
import { expectCount, expectVisible } from '../lib/wait'
import { makeGitRepo, openCodeProject } from '../lib/fase6'

const SHOTS = process.env.COMPARAR_SHOTS_DIR
const git = (cwd: string, ...a: string[]): string => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' })
const compareWorktrees = (repo: string): string[] =>
  git(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree ') && l.includes('onyx-compare-'))
const compareBranches = (repo: string): string[] =>
  git(repo, 'branch', '--list', 'onyx-compare/*')
    .split('\n')
    .filter((l) => l.trim())

const MODELS = [
  { id: 'fake/fake-model', name: 'Fake Model' },
  { id: 'fake/fake-reasoner', name: 'Fake Reasoner' },
  { id: 'opencode-go/fake-go-model', name: 'Fake Go Model' }
]

/** Abre el lanzador del compositor y marca los modelos por su nombre visible; deja la comparación armada. */
async function armCompare(app: E2EApp, names: string[]): Promise<void> {
  const page = app.page
  await page.getByRole('button', { name: 'Comparar modelos…' }).click()
  const launcher = page.getByRole('dialog', { name: 'Comparar modelos' })
  await expectVisible(launcher, 10_000)
  for (const name of names) {
    await launcher.getByRole('option', { name: new RegExp(name) }).click()
  }
  await launcher.getByRole('button', { name: new RegExp(`^Comparar \\(${names.length}\\)`) }).click()
  await expectVisible(page.getByTestId('compare-chip'), 5_000)
}

async function confirmLaunch(app: E2EApp): Promise<void> {
  const dialog = app.page.getByRole('dialog', { name: '¿Lanzar la comparación?' })
  await expectVisible(dialog, 15_000)
  // El aviso «×N» tiene que estar a la vista antes de lanzar.
  await expectVisible(dialog.getByText(/el uso se multiplica ×\d/))
  await dialog.getByRole('button', { name: 'Comparar', exact: true }).click()
}

describe.skipIf(MODE === 'prod' || IS_WIN)(`comparar modelos, Code (${MODE})`, () => {
  let repo = ''
  beforeAll(() => {
    repo = makeGitRepo('onyx-e2e-compare-')
  })
  const app = useApp()
  afterEach(async () => {
    // Si un test dejó una comparación abierta, se cierra por la API (sin diálogo) para no contaminar el siguiente.
    await app()
      .page.evaluate(async () => {
        const w = window as unknown as {
          api: { code: { compare: { list(): Promise<{ id: string }[]>; close(id: string): Promise<unknown> } } }
        }
        for (const m of await w.api.code.compare.list()) await w.api.code.compare.close(m.id).catch(() => undefined)
      })
      .catch(() => undefined)
  })
  afterAll(async () => {
    await app()
      .stop()
      .catch(() => undefined)
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('3 modelos: columnas, copias aparte, límite de uso con reintento programado, coste «$0,01»; «Quedarme con este» aplica sin commit y limpia', async () => {
    const a = app()
    await a.fake.script({
      scripts: [
        {
          forModel: MODELS[0].id,
          steps: [
            { type: 'fs', op: 'write', path: 'a.txt', content: 'uno\n' },
            { type: 'text', text: 'Listo A' }
          ],
          cost: 0.01
        },
        {
          forModel: MODELS[1].id,
          steps: [
            { type: 'fs', op: 'write', path: 'b.txt', content: 'dos\n' },
            { type: 'text', text: 'Listo B' }
          ],
          startDelayMs: 800
        },
        { forModel: MODELS[2].id, steps: [{ type: 'error', preset: 'quota' }], sticky: true }
      ]
    })
    await openCodeProject(a, repo)
    await armCompare(
      a,
      MODELS.map((m) => m.name)
    )
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('crea el archivo pedido')
    await box.press('Enter')
    await confirmLaunch(a)

    // Tres columnas, cada una una región con el nombre del modelo.
    for (const m of MODELS) await expectVisible(a.page.getByRole('region', { name: m.name }), 20_000)
    expect(await a.page.getByTestId('compare-view').getByRole('region').count()).toBe(3)

    // Copias en carpetas distintas `.<repo>-worktrees/onyx-compare-*` (el límite de Go puede no haber creado la suya aún: al menos 2).
    await expect.poll(() => compareWorktrees(repo).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    const dirs = compareWorktrees(repo).map((l) => l.replace('worktree ', ''))
    expect(new Set(dirs).size).toBe(dirs.length)
    for (const d of dirs) expect(d).toMatch(/\.onyx-e2e-compare-[^/]*-worktrees|-worktrees/)

    // La columna de Go pasa a «Límite de uso» con un reintento programado (cuenta atrás visible).
    const go = a.page.getByRole('region', { name: 'Fake Go Model' })
    await expectVisible(go.getByText('Límite de uso'), 30_000)
    await expectVisible(go.getByText(/Reintento en \d+ s/))
    // Cada modelo recibió SU prompt (el guion por modelo se eligió por `body.model`): al menos uno por modelo en el motor.
    const prompts = (await a.fake.requests({ limit: 1000, method: 'POST' })).filter((r) => /\/session\/[^/]+\/prompt_async$/.test(r.path))
    const asked = new Set(
      prompts.map((r) => {
        const m = (r.body as { model?: { providerID?: string; modelID?: string } } | null)?.model
        return m ? `${m.providerID}/${m.modelID}` : ''
      })
    )
    for (const m of MODELS) expect(asked.has(m.id), m.id).toBe(true)

    // Métricas: «$0,01» en la columna con coste; «—» (nunca «$0») en la que no informa.
    const fm = a.page.getByRole('region', { name: 'Fake Model' })
    await expectVisible(fm.getByText('Listo', { exact: true }), 30_000)
    await expect.poll(() => fm.getByTestId('compare-cost-0').innerText()).toMatch(/0,01/)
    const reasoner = a.page.getByRole('region', { name: 'Fake Reasoner' })
    await expectVisible(reasoner.getByText('Listo', { exact: true }), 30_000)
    await expect.poll(() => reasoner.getByTestId('compare-cost-1').innerText()).toMatch(/—/)
    expect(await a.page.getByTestId('compare-view').innerText()).not.toMatch(/\$\s?0([^,.\d]|$)/)
    await shot(a, SHOTS, 'comparar-columnas')

    // Cajón de diff: se abre con «Ver cambios» y se cierra con Esc devolviendo el foco.
    await fm.getByRole('button', { name: 'Ver cambios' }).click()
    await expectVisible(a.page.getByTestId('compare-diff-drawer'), 10_000)
    await expect.poll(() => a.page.getByTestId('compare-diff-drawer').innerText()).toContain('a.txt')
    await a.page.keyboard.press('Escape')
    await expectCount(a.page.getByTestId('compare-diff-drawer'), 0)

    // «Quedarme con este» en la columna 1: a.txt llega al árbol SIN commit, b.txt no; ninguna copia ni rama queda.
    await fm.getByRole('button', { name: 'Quedarme con Fake Model' }).click()
    await a.page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click()
    await expect.poll(() => existsSync(join(repo, 'a.txt')), { timeout: 30_000 }).toBe(true)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uno\n')
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(git(repo, 'status', '--porcelain')).toContain('a.txt')
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1)
    await expect.poll(() => compareWorktrees(repo).length, { timeout: 30_000 }).toBe(0)
    expect(compareBranches(repo)).toHaveLength(0)
    await expectCount(a.page.getByTestId('compare-view'), 0)
  })

  it('«Cancelar todo»: aborta las sesiones y deja las columnas en «Cancelado» en menos de 10 s', async () => {
    const a = app()
    await a.fake.script({
      scripts: [
        { forModel: MODELS[0].id, steps: [{ type: 'text', text: 'lento', delayMs: 30_000 }] },
        { forModel: MODELS[1].id, steps: [{ type: 'text', text: 'lento', delayMs: 30_000 }] }
      ]
    })
    await openCodeProject(a, repo)
    await armCompare(a, [MODELS[0].name, MODELS[1].name])
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('tarea larga')
    await box.press('Enter')
    await confirmLaunch(a)
    await expectVisible(a.page.getByRole('region', { name: 'Fake Model' }).getByText('Trabajando'), 30_000)
    const t0 = Date.now()
    await a.page.getByRole('button', { name: 'Cancelar todo' }).click()
    for (const m of MODELS.slice(0, 2)) await expectVisible(a.page.getByRole('region', { name: m.name }).getByText('Cancelado'), 10_000)
    expect(Date.now() - t0).toBeLessThan(10_000)
    const aborts = (await a.fake.requests({ limit: 1000, method: 'POST' })).filter((r) => /\/session\/[^/]+\/abort$/.test(r.path))
    expect(aborts.length).toBeGreaterThanOrEqual(2)
    await shot(a, SHOTS, 'comparar-cancelado')
    // Cerrar la comparación pide confirmación y limpia las copias.
    await a.page.getByRole('button', { name: 'Cerrar', exact: true }).first().click()
    await a.page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect.poll(() => compareWorktrees(repo).length, { timeout: 30_000 }).toBe(0)
    expect(compareBranches(repo)).toHaveLength(0)
  })
})

describe.skipIf(MODE === 'prod' || IS_WIN)(`comparar modelos, recuperación al arrancar (${MODE})`, () => {
  const state = {} as { repo: string; userData: string; app: E2EApp | null }
  beforeAll(() => {
    state.repo = makeGitRepo('onyx-e2e-compare-rec-')
    state.userData = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-')))
    state.app = null
  })
  afterAll(async () => {
    await state.app?.stop().catch(() => undefined)
    rmSync(state.repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    rmSync(state.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('con una comparación sin cerrar, tras reiniciar sale la franja «Abrir · Descartar»; «Descartar» limpia las copias', async () => {
    let a = await startApp({ userData: state.userData, keepUserData: true })
    state.app = a
    await a.fake.script({
      scripts: [
        { forModel: MODELS[0].id, steps: [{ type: 'text', text: 'lento', delayMs: 60_000 }] },
        { forModel: MODELS[1].id, steps: [{ type: 'text', text: 'lento', delayMs: 60_000 }] }
      ]
    })
    await openCodeProject(a, state.repo)
    await armCompare(a, [MODELS[0].name, MODELS[1].name])
    const box = a.page.getByPlaceholder(/Pide un cambio en el código/)
    await box.fill('algo largo')
    await box.press('Enter')
    await confirmLaunch(a)
    await expectVisible(a.page.getByRole('region', { name: 'Fake Model' }).getByText('Trabajando'), 30_000)
    await expect.poll(() => compareWorktrees(state.repo).length, { timeout: 30_000 }).toBe(2)

    // Se cierra la app con las columnas en curso (el manifiesto queda en userData) y se vuelve a abrir.
    await a.stop()
    a = await startApp({ userData: state.userData, keepUserData: true })
    state.app = a
    await openCodeProject(a, state.repo)
    const banner = a.page.getByTestId('compare-recovery')
    await expectVisible(banner, 30_000)
    await expect.poll(() => banner.innerText()).toContain('1 comparación sin cerrar')
    expect(compareWorktrees(state.repo).length).toBe(2) // al arrancar no se borra nada solo
    await shot(a, SHOTS, 'comparar-recuperacion')

    // «Abrir» muestra las columnas como interrumpidas (nunca como «Trabajando»).
    await banner.getByRole('button', { name: 'Abrir' }).click()
    await expectVisible(a.page.getByRole('region', { name: 'Fake Model' }).getByText('Interrumpido'), 15_000)
    await a.page.getByRole('button', { name: 'Cerrar', exact: true }).first().click()
    await a.page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect.poll(() => compareWorktrees(state.repo).length, { timeout: 30_000 }).toBe(0)
    expect(compareBranches(state.repo)).toHaveLength(0)
  })
})

describe.skipIf(MODE === 'prod')(`comparar modelos, Chat (${MODE})`, () => {
  const app = useApp()
  it('2 modelos: las sesiones no salen en la lista hasta elegir una; la no elegida se borra y la elegida queda como conversación normal', async () => {
    const a = app()
    await a.fake.script({
      scripts: [
        { forModel: MODELS[0].id, steps: [{ type: 'text', text: 'Respuesta A' }] },
        { forModel: MODELS[1].id, steps: [{ type: 'text', text: 'Respuesta B' }] }
      ]
    })
    await a.page.locator('nav[aria-label="Modo"]').getByRole('button', { name: 'Chat' }).click()
    await a.page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    await armCompare(a, [MODELS[0].name, MODELS[1].name])
    const box = a.page.getByPlaceholder('Escribe un mensaje…')
    await box.fill('compara estas dos respuestas')
    await a.page.getByRole('button', { name: 'Comparar en 2 modelos' }).click()
    await confirmLaunch(a)
    await expectVisible(a.page.getByRole('region', { name: 'Fake Model' }).getByText('Respuesta A'), 30_000)
    await expectVisible(a.page.getByRole('region', { name: 'Fake Reasoner' }).getByText('Respuesta B'), 30_000)
    // Sin adjuntos en v1 y nada de «Ver cambios» en Chat.
    expect(await a.page.getByRole('button', { name: 'Ver cambios' }).count()).toBe(0)
    // Las sesiones de la comparación no son conversaciones todavía: la lista de Chat no las muestra.
    const listed = (): Promise<string[]> =>
      a.page.evaluate(() => Array.from(document.querySelectorAll('[aria-current], aside button')).map((e) => e.textContent ?? ''))
    expect((await listed()).filter((t) => /compara estas dos respuestas/.test(t))).toHaveLength(0)
    await shot(a, SHOTS, 'comparar-chat')

    const before = (await a.fake.requests({ limit: 1000, method: 'DELETE' })).length
    await a.page.getByRole('region', { name: 'Fake Model' }).getByRole('button', { name: 'Quedarme con Fake Model' }).click()
    await a.page.getByRole('dialog').getByRole('button', { name: 'Seguir con este' }).click()
    // La sesión elegida se abre como conversación normal; la otra se borra en el motor.
    await expectVisible(a.page.getByText('Respuesta A'), 30_000)
    await expect
      .poll(
        async () =>
          (await a.fake.requests({ limit: 1000, method: 'DELETE' })).filter((r) => /\/session\/[^/]+$/.test(r.path)).length - before,
        { timeout: 30_000 }
      )
      .toBeGreaterThanOrEqual(1)
    const active = await storeState<string | null>(a.page, 'useChat', 'activeSessionId')
    expect(active).toBeTruthy()
    await expectCount(a.page.getByTestId('compare-view'), 0)
  })
})
