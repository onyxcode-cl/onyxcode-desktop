// Ajustes › Diagnóstico contra la app real y el OpenCode falso: estado del motor, registros en vivo y de archivo,
// copiado y exportación. Ningún secreto conocido (clave guardada, cabecera de un MCP, contraseña del sidecar) llega a
// la pantalla, al portapapeles ni al archivo exportado (que además queda en 0600). Capturas con DIAG_SHOTS_DIR.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { dialogCalls, stubDialog } from '../lib/dialogs'
import { useApp } from '../lib/harness'
import { consumeErrors } from '../lib/fase6'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { connection } from '../lib/stores'
import { expectVisible } from '../lib/wait'

const DEV = MODE === 'dev'
const SHOTS = process.env.DIAG_SHOTS_DIR
const out = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-diag-')))
afterAll(() => rmSync(out, { recursive: true, force: true }))

const STORED_KEY = 'clave-guardada-sin-forma-0123'
const MCP_SECRET = 'cabecera-mcp-secreta-4567'
const ENGINE_KEY = 'sk-e2e-engine-0123456789abcdef'
const FILE_KEY = 'sk-ant-api03-ARCHIVO0123456789abcdef'

async function openDiagnostics(page: Page): Promise<void> {
  await page.keyboard.press('Meta+,')
  const nav = page.locator('nav[aria-label="Secciones de ajustes"]')
  await expectVisible(nav)
  await nav.getByRole('button', { name: 'Diagnóstico', exact: true }).click()
  await expectVisible(page.getByRole('heading', { name: 'Diagnóstico' }))
}

const logText = (page: Page): Promise<string> => page.getByTestId('diag-log').innerText()

describe.skipIf(!DEV)('Ajustes › Diagnóstico', () => {
  const app = useApp()
  let secrets: string[] = []

  it('(1) estado del motor y registros en vivo, sin secretos', async () => {
    const a = app()
    const { page, fake, userData } = a
    // Secretos conocidos: clave guardada y cabecera de un MCP, en los archivos reales de la app.
    mkdirSync(join(userData, 'opencode-data', 'opencode'), { recursive: true })
    writeFileSync(join(userData, 'opencode-data', 'opencode', 'auth.json'), JSON.stringify({ openai: { type: 'api', key: STORED_KEY } }), {
      mode: 0o600
    })
    mkdirSync(join(userData, 'opencode'), { recursive: true })
    writeFileSync(
      join(userData, 'opencode', 'opencode.json'),
      JSON.stringify({
        mcp: {
          prueba: { type: 'remote', url: 'http://127.0.0.1:1/mcp', enabled: false, headers: { Authorization: `Bearer ${MCP_SECRET}` } }
        }
      })
    )
    const { authorization } = await connection(page)
    const password = Buffer.from(authorization.replace('Basic ', ''), 'base64').toString().split(':')[1]
    secrets = [STORED_KEY, MCP_SECRET, ENGINE_KEY, FILE_KEY, authorization, authorization.slice(6), password]
    const post = (text: string): Promise<Response> =>
      fetch(`${a.fake.conn.baseUrl}/__e2e/log`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ stream: 'stderr', text })
      })
    void fake
    await post('level=info msg="motor listo para el diagnóstico"')
    await post(`level=warn msg="llamada" key=${ENGINE_KEY} auth=${STORED_KEY}`)
    await post(`level=debug Authorization: ${authorization} password=${password} header=${MCP_SECRET}`)
    await post(`level=info msg="archivo" path=${homedir()}/Documents/informe.txt`)

    await openDiagnostics(page)
    await expectVisible(page.getByText('Funcionando', { exact: true }))
    await expect.poll(() => page.getByTestId('diag-restarts').innerText()).toBe('0')
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    await expect.poll(() => logText(page), { timeout: 15_000 }).toContain('motor listo para el diagnóstico')
    const text = await logText(page)
    expect(text).toContain('…')
    expect(text).toContain('~/Documents/informe.txt')
    for (const s of secrets) expect(text, `pantalla con ${s}`).not.toContain(s)
    expect(await page.content()).not.toContain(password)
    // Tampoco por el IPC (lo que recibe el renderer): ni la fuente en vivo ni el informe.
    for (const source of ['engine', 'report']) {
      const r = await page.evaluate((src) => (window as any).api.invoke('diag:logs', { source: src }), source)
      for (const s of secrets) expect(JSON.stringify(r), `${source} con ${s}`).not.toContain(s)
    }
    await expectVisible(page.getByText(/Las claves y contraseñas se ocultan/))
    await shot(a, SHOTS, 'diagnostico')
  })

  it('(2) filtro y auto-actualización', async () => {
    const { page } = app()
    await page.getByLabel('Filtrar registros').fill('motor listo')
    await expect.poll(() => logText(page)).toContain('motor listo para el diagnóstico')
    expect(await logText(page)).not.toContain('level=warn')
    await page.getByLabel('Filtrar registros').fill('no-existe-esta-linea')
    await expect.poll(() => logText(page)).toContain('Ninguna línea coincide')
    await page.getByLabel('Filtrar registros').fill('')
    await page.getByRole('switch', { name: 'Actualizar cada 2 segundos' }).click()
    const a = app()
    await fetch(`${a.fake.conn.baseUrl}/__e2e/log`, {
      method: 'POST',
      headers: { authorization: a.fake.conn.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ stream: 'stderr', text: 'linea-nueva-auto' })
    })
    await expect.poll(() => logText(page), { timeout: 10_000 }).toContain('linea-nueva-auto')
    await page.getByRole('switch', { name: 'Actualizar cada 2 segundos' }).click()
  })

  it('(3) «Copiar» deja en el portapapeles el texto redactado', async () => {
    const { page, electronApp } = app()
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('vacío'))
    await page.getByRole('button', { name: 'Copiar' }).click()
    await expectVisible(page.getByText(/Copiado: \d+ líneas?/))
    const clip = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toContain('motor listo para el diagnóstico')
    expect(clip).toContain('…')
    for (const s of secrets) expect(clip, `portapapeles con ${s}`).not.toContain(s)
  })

  it('(4) registro del archivo del motor: se muestra redactado', async () => {
    const a = app()
    const { page } = a
    const logDir = join(a.userData, 'opencode-data', 'opencode', 'log')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(
      join(logDir, 'opencode.log'),
      [
        `INFO 2026-10-01T10:00:00 service=server msg="arranque" apiKey=${FILE_KEY}`,
        `ERROR 2026-10-01T10:00:01 service=llm error="401" token=${ENGINE_KEY}`,
        `INFO guardada ${STORED_KEY}`
      ].join('\n') + '\n'
    )
    await page.getByLabel('Fuente de registros').selectOption('engine-file')
    await expect.poll(() => logText(page), { timeout: 15_000 }).toContain('service=server msg="arranque"')
    const text = await logText(page)
    for (const s of secrets) expect(text, `archivo con ${s}`).not.toContain(s)
    expect(text).toContain('…')
  })

  it('(5) «Exportar…» guarda el informe redactado con permisos 0600', async () => {
    const a = app()
    const { page, electronApp } = a
    const dest = join(out, 'diagnostico.txt')
    await stubDialog(electronApp, { savePath: dest })
    await page.getByRole('button', { name: 'Exportar…' }).click()
    await expectVisible(page.getByText('Informe exportado.'))
    expect(existsSync(dest)).toBe(true)
    expect(statSync(dest).mode & 0o777).toBe(0o600)
    const calls = await dialogCalls(electronApp)
    const save = calls.find((c) => c.kind === 'save')!.options as { defaultPath: string }
    expect(save.defaultPath).toMatch(/^OnyxCode-diagnostico-\d{8}-\d{4}\.txt$/)
    const text = readFileSync(dest, 'utf8')
    expect(text).toContain('informe de diagnóstico')
    expect(text).toContain('Versiones')
    expect(text).toContain('service=server msg="arranque"')
    for (const s of secrets) expect(text, `exportación con ${s}`).not.toContain(s)
  })

  it('(6) «Reiniciar OpenCode» reinicia el motor y el registro en vivo conserva la historia', async () => {
    const a = app()
    const { page } = a
    const oldUrl = (await connection(page)).baseUrl
    await page.getByRole('button', { name: 'Reiniciar OpenCode' }).click()
    await expect.poll(async () => (await connection(page)).baseUrl, { timeout: 60_000 }).not.toBe(oldUrl)
    await expectVisible(page.getByText('Funcionando', { exact: true }), 60_000)
    // El único aviso de red esperado es el corte del SSE por el reinicio.
    consumeErrors(a, /\/global\/event/)
    await page.getByLabel('Fuente de registros').selectOption('engine')
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    // El anillo vive en main: tras el reinicio siguen las líneas de antes y aparece el arranque nuevo.
    await expect
      .poll(async () => ((await logText(page)).match(/opencode server listening/g) ?? []).length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2)
    expect(await logText(page)).toContain('linea-nueva-auto')
    await shot(a, SHOTS, 'diagnostico-tras-reinicio')
  })
})
