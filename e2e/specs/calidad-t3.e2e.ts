// Calidad T3 (F8-B32): continuidad del trabajo. (1) el shell de la terminal de Code sobrevive a cambiar de modo y a
// Ajustes (mismo pid, `sleep` vivo, scrollback intacto); (2) los borradores de Chat y Code se conservan; (3) tareas
// «Interrumpidas» con «Continuar» (y sin marcar las que siguen ocupadas); (4) Cmd+Q con una tarea ocupada pregunta
// (Cancelar = sigue abierta; Salir igualmente = sale) y sin tareas sale sin preguntar. Capturas: T3_SHOTS_DIR.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { storeCall, storeState } from '../lib/stores'
import { expectVisible } from '../lib/wait'
import { dialogCalls, stubDialog } from '../lib/dialogs'
import { connectTasksFolder, consumeErrors, makeGitRepo, makeHomeFolder, openCodeProject, prepareFakeBin } from '../lib/fase6'
import { waitIdle } from '../lib/lru'
import { childrenOf, alive, IS_WIN } from '../lib/proc'

const SHOTS = process.env.T3_SHOTS_DIR
const modeBtn = (page: import('playwright-core').Page, name: string) => page.locator('nav[aria-label="Modo"]').getByRole('button', { name })

// Windows: `sleep` de PowerShell es un alias sin proceso hijo; se usa `ping -n` (un hijo real, 1 paquete por segundo, sin carga).
const SLEEPER = IS_WIN ? 'ping -n 1000 127.0.0.1 > $null' : 'sleep 1000'
const SLEEPER_MARK = IS_WIN ? 'PING.EXE' : 'sleep 1000'
const sleeperPid = (pid: number): number =>
  Number(
    childrenOf(pid)
      .split('\n')
      .find((l) => l.includes(SLEEPER_MARK))
      ?.trim()
      .split(/\s+/)[0]
  )

describe.skipIf(MODE === 'prod')(`calidad T3 (${MODE})`, () => {
  const res = {} as { bin: ReturnType<typeof prepareFakeBin>; folder: ReturnType<typeof makeHomeFolder> }
  const env: Record<string, string> = {}
  let repo = ''
  beforeAll(() => {
    res.bin = prepareFakeBin()
    res.folder = makeHomeFolder()
    repo = makeGitRepo()
    Object.assign(env, res.bin.env)
  })
  const app = useApp({ env })
  afterAll(async () => {
    // Los afterAll corren en orden inverso: sin parar antes la app, en Windows la terminal aún tiene el repo como cwd (EBUSY).
    await app().stop().catch(() => undefined)
    res.folder?.cleanup()
    res.bin?.cleanup()
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })

  it('Code: el pid de la terminal y su `sleep` sobreviven a Chat, Ajustes y ⌃Tab; el scrollback sigue', async () => {
    const a = app()
    const { page } = a
    await openCodeProject(a, repo)
    await storeCall(page, 'useCode', 'togglePanel', 'terminal')
    const term = page.locator('.xterm-helper-textarea').first()
    await term.waitFor({ state: 'attached', timeout: 20_000 })
    const ptys = (): Promise<{ id: string; pid: number; cwd: string }[]> => page.evaluate(() => (window as any).api.code.pty.list())
    await expect.poll(async () => (await ptys()).length, { timeout: 15_000 }).toBe(1)
    // Windows (ConPTY): el pid del shell puede tardar en conocerse tras crear el pty.
    await expect.poll(async () => (await ptys())[0]?.pid, { timeout: 15_000 }).toBeGreaterThan(0)
    const before = (await ptys())[0]
    await page.locator('.xterm').first().click()
    await page.keyboard.type(`echo MARCA_T3${IS_WIN ? ';' : ' &&'} ${SLEEPER}`, { delay: 15 })
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator('.xterm-rows').first().innerText(), { timeout: 15_000 }).toContain('MARCA_T3')
    await expect.poll(() => childrenOf(before.pid), { timeout: 10_000 }).toContain(SLEEPER_MARK)
    const sleepPid = sleeperPid(before.pid)
    expect(alive(sleepPid)).toBe(true)
    await shot(a, SHOTS, 'terminal-antes')

    // Chat → Ajustes → Code
    await modeBtn(page, 'Chat').click()
    await expectVisible(page.getByPlaceholder('Escribe un mensaje…'))
    expect(await page.locator('.xterm').count()).toBe(0) // la vista Code se desmontó de verdad
    await storeCall(page, 'useUi', 'openSettings', true)
    await page.waitForTimeout(500)
    await storeCall(page, 'useUi', 'openSettings', false)
    // ⌃Tab recorre los modos (Chat → Code): los atajos siguen vivos y el cambio de modo funciona.
    await page.keyboard.press('Control+Tab')
    await expect.poll(() => storeState(page, 'useUi', 'mode')).toBe('code')
    await expect.poll(() => page.locator('.xterm-rows').first().innerText(), { timeout: 10_000 }).toContain('MARCA_T3')

    const after = await ptys()
    expect(after).toHaveLength(1)
    expect(after[0].pid).toBe(before.pid)
    expect(after[0].id).toBe(before.id)
    expect(alive(sleepPid)).toBe(true)
    expect(childrenOf(before.pid)).toContain(SLEEPER_MARK)
    // La terminal reenganchada acepta teclado y se ve en su sitio.
    await page.locator('.xterm').first().click()
    await page.keyboard.type('echo SIGUE_T3', { delay: 15 })
    await shot(a, SHOTS, 'terminal-despues')
    await page.keyboard.press('Control+C')
    await expect.poll(() => alive(sleepPid), { timeout: 10_000 }).toBe(false)
  }, 120_000)

  it('Chat y Code conservan el borrador al cambiar de modo, por sesión', async () => {
    const a = app()
    const { page } = a
    await modeBtn(page, 'Chat').click()
    await page.getByRole('button', { name: 'Nueva conversación' }).first().click()
    const chatBox = page.getByPlaceholder('Escribe un mensaje…')
    await chatBox.fill('borrador de chat sin enviar')
    await modeBtn(page, IS_WIN ? 'Rutinas' : 'Tareas').click()
    await storeCall(page, 'useUi', 'openSettings', true)
    await storeCall(page, 'useUi', 'openSettings', false)
    await modeBtn(page, 'Chat').click()
    await expect.poll(() => chatBox.inputValue(), { timeout: 5_000 }).toBe('borrador de chat sin enviar')
    await shot(a, SHOTS, 'borrador-chat')

    await openCodeProject(a, repo)
    const codeBox = page.getByPlaceholder(/^(Pide un cambio|Describe qué quieres planificar)/)
    await codeBox.fill('borrador de code sin enviar')
    await modeBtn(page, 'Chat').click()
    await modeBtn(page, 'Code').click()
    await expect.poll(() => codeBox.inputValue(), { timeout: 5_000 }).toBe('borrador de code sin enviar')
  }, 60_000)

  // Windows v1: sin modo Tareas.
  it.skipIf(IS_WIN)('Tareas: una tarea a medias se marca «Interrumpida» con «Continuar»; la que sigue ocupada no', async () => {
    const a = app()
    const { page } = a
    const { fake } = await connectTasksFolder(a, res.folder.path)
    const slow = (match: string, title: string) =>
      fake.script({
        match,
        title,
        steps: [
          { type: 'text', text: `Trabajando en ${title}.` },
          { type: 'delay', ms: 120_000 },
          { type: 'text', text: ' Fin.' }
        ]
      })
    await slow('CORTADA', 'Tarea cortada')
    await slow('OCUPADA', 'Tarea ocupada')
    await fake.script({
      match: 'Continúa la tarea desde donde se interrumpió',
      title: 'Tarea cortada',
      steps: [{ type: 'text', text: 'Retomo y termino.' }]
    })
    const start = async (prompt: string, wait: string): Promise<string> => {
      await page
        .getByRole('button', { name: /^Nueva tarea/ })
        .first()
        .click()
      await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill(prompt)
      await page.getByRole('button', { name: 'Enviar' }).click()
      await expectVisible(page.getByText(wait, { exact: false }).first(), 30_000)
      return (await storeState<string>(page, 'useTasks', 'activeTaskId'))!
    }
    const cut = await start('CORTADA haz algo', 'Trabajando en Tarea cortada.')
    const busy = await start('OCUPADA haz algo', 'Trabajando en Tarea ocupada.')
    // El motor «se reinició»: la tarea cortada perdió su ejecución con el mensaje a medias; la otra sigue trabajando.
    await fake.set({ sessionStatus: { [cut]: 'idle' } })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('nav[aria-label="Modo"]').waitFor()
    await expect.poll(() => storeState<Record<string, true>>(page, 'useTasks', 'interrupted'), { timeout: 30_000 }).toEqual({ [cut]: true })
    expect(await storeState(page, 'useSessions', `status.${busy}`)).not.toBe('idle')

    await modeBtn(page, 'Tareas').click()
    await page
      .getByRole('button', { name: /CORTADA haz algo/ })
      .first()
      .click()
    await expectVisible(page.getByText('Esta tarea se interrumpió'))
    await expect(page.getByText('Interrumpida').first().isVisible()).resolves.toBe(true)
    await shot(a, SHOTS, 'tarea-interrumpida')
    // La ocupada no muestra el aviso.
    await page
      .getByRole('button', { name: /OCUPADA haz algo/ })
      .first()
      .click()
    await page.waitForTimeout(600)
    expect(await page.getByText('Esta tarea se interrumpió').count()).toBe(0)

    await page
      .getByRole('button', { name: /CORTADA haz algo/ })
      .first()
      .click()
    // El falso aún tiene viva la ejecución perdida (el motor real no): se aborta para que «Continuar» no quede en cola tras ella.
    const abort = new URL(`${fake.conn.baseUrl}/session/${cut}/abort`)
    abort.searchParams.set('directory', res.folder.path)
    await fetch(abort, { method: 'POST', headers: { authorization: fake.conn.authorization } })
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
    await expectVisible(page.getByText('Retomo y termino.'), 30_000)
    await waitIdle(page, cut, 30_000)
    expect(await page.getByText('Esta tarea se interrumpió').count()).toBe(0)
    expect(await storeState(page, 'useTasks', `interrupted.${cut}`)).toBeUndefined()
  }, 150_000)
})

describe.skipIf(MODE === 'prod')(`calidad T3: salir (${MODE})`, () => {
  const bin = prepareFakeBin()
  const folder = makeHomeFolder()
  const app = useApp({ env: bin.env })
  afterAll(() => {
    folder.cleanup()
    bin.cleanup()
  })

  // Windows v1: sin modo Tareas (la salida con una tarea ocupada es del modo Tareas).
  it.skipIf(IS_WIN)('Cmd+Q con una tarea ocupada pregunta; Cancelar mantiene la app y «Salir igualmente» sale', async () => {
    const a = app()
    const { page, electronApp } = a
    const { fake } = await connectTasksFolder(a, folder.path)
    await fake.script({
      match: 'LARGA',
      title: 'Tarea larga',
      steps: [
        { type: 'text', text: 'Trabajo largo en curso.' },
        { type: 'delay', ms: 120_000 }
      ]
    })
    await page
      .getByRole('button', { name: /^Nueva tarea/ })
      .first()
      .click()
    await page.getByPlaceholder('Describe la tarea que quieres delegar…').fill('LARGA haz algo')
    await page.getByRole('button', { name: 'Enviar' }).click()
    await expectVisible(page.getByText('Trabajo largo en curso.', { exact: false }).first(), 30_000)
    // El monitor de main ve la tarea (sondeo cada 3 s).
    await expect.poll(() => storeState<number>(page, 'useTasks', 'activity.tasks.length'), { timeout: 20_000 }).toBeGreaterThan(0)

    await stubDialog(electronApp, { messageBoxResponse: 1 })
    await electronApp.evaluate(({ app }) => app.quit())
    await expect.poll(async () => (await dialogCalls(electronApp)).filter((c) => c.kind === 'message').length, { timeout: 10_000 }).toBe(1)
    const opts = (await dialogCalls(electronApp)).find((c) => c.kind === 'message')!.options as { message: string; buttons: string[] }
    expect(opts.message).toBe('Hay 1 tarea en curso.')
    expect(opts.buttons).toEqual(['Salir igualmente', 'Cancelar'])
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => document.title.length > 0)).toBe(true) // sigue viva y responde
    await shot(a, SHOTS, 'salir-cancelado')

    await stubDialog(electronApp, { messageBoxResponse: 0 })
    const closed = new Promise<void>((r) => electronApp.process().once('exit', () => r()))
    await electronApp.evaluate(({ app }) => app.quit())
    await Promise.race([
      closed,
      new Promise((_, rej) => setTimeout(() => rej(new Error('la app no salió tras «Salir igualmente»')), 30_000))
    ])
    // Al salir se cierran los streams de eventos de los servidores: Chromium lo registra como error de red (esperado).
    consumeErrors(a, /ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONNECTION/)
  }, 90_000)
})
