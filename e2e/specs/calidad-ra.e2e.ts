// Calidad R2-A: descartar cambios en el panel Cambios de Code con un repo temporal REAL (git de verdad, Papelera de pruebas).
// Confirmación explícita, restauración del archivo modificado, «Deshacer», archivo nuevo a la Papelera y rutas fuera del repo
// rechazadas por main. Capturas con RA_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { expectVisible } from '../lib/wait'
import { makeGitRepo, openCodeProject } from '../lib/fase6'

const SHOTS = process.env.RA_SHOTS_DIR
const trashDir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-ra-trash-')))
let repo = ''
const outside = join(realpathSync(tmpdir()), `onyx-e2e-ra-fuera-${process.pid}.txt`)

describe.skipIf(MODE === 'prod')(`calidad R2-A (${MODE})`, () => {
  beforeAll(() => {
    repo = makeGitRepo('onyx-e2e-ra-')
    writeFileSync(outside, 'fuera del repo\n')
  })
  const app = useApp({ env: { ONYXCODE_E2E_TRASH_DIR: trashDir } })
  afterAll(() => {
    rmSync(trashDir, { recursive: true, force: true })
    rmSync(outside, { force: true })
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8')
  const gitOut = (...a: string[]): string => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })

  it('descartar un archivo modificado pide confirmación, lo restaura y «Deshacer» lo recupera', async () => {
    const a = app()
    writeFileSync(join(repo, 'README.md'), '# e2e\ntrabajo valioso sin guardar\n')
    await openCodeProject(a, repo)
    const changes = a.page.getByRole('button', { name: 'Cambios', exact: true })
    if ((await changes.first().getAttribute('aria-pressed')) !== 'true') await changes.first().click()
    const discard = a.page.getByRole('button', { name: 'Descartar los cambios de README.md' })
    await discard.click({ force: true })
    const dialog = a.page.getByRole('alertdialog')
    await expectVisible(dialog.getByText('¿Descartar los cambios de README.md?'))
    await expectVisible(dialog.getByText('• README.md'))
    await shot(a, SHOTS, 'confirmar-descartar')
    // Cancelar no toca nada.
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    expect(read('README.md')).toContain('trabajo valioso')
    // Confirmar.
    await discard.click({ force: true })
    await a.page.getByRole('alertdialog').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expectVisible(a.page.getByText('1 archivo restaurado.'))
    expect(read('README.md')).toBe('# e2e\n')
    expect(gitOut('status', '--porcelain')).toBe('')
    await shot(a, SHOTS, 'descartado-con-deshacer')
    // Deshacer devuelve el contenido.
    await a.page.getByRole('button', { name: 'Deshacer', exact: true }).click()
    await expectVisible(a.page.getByText('Cambios recuperados.'))
    expect(read('README.md')).toBe('# e2e\ntrabajo valioso sin guardar\n')
  })

  it('un archivo nuevo va a la Papelera (nunca se borra) y la ruta fuera del repo se rechaza', async () => {
    const a = app()
    writeFileSync(join(repo, 'nuevo.txt'), 'contenido nuevo\n')
    await a.page.getByRole('button', { name: 'Actualizar', exact: true }).click() // sin vigilante de archivos en el falso
    await expectVisible(a.page.getByRole('button', { name: 'Descartar los cambios de nuevo.txt' }), 20_000)
    await a.page.getByRole('button', { name: 'Descartar los cambios de nuevo.txt' }).click({ force: true })
    const dialog = a.page.getByRole('alertdialog')
    await expectVisible(dialog.getByText('Papelera', { exact: false }))
    await shot(a, SHOTS, 'confirmar-archivo-nuevo')
    await dialog.getByRole('button', { name: 'Descartar', exact: true }).click()
    await expectVisible(a.page.getByText('1 archivo nuevo movido a la Papelera.'))
    expect(existsSync(join(repo, 'nuevo.txt'))).toBe(false)
    const trashed = readdirSync(trashDir)
    expect(trashed).toHaveLength(1)
    expect(readFileSync(join(trashDir, trashed[0]), 'utf8')).toBe('contenido nuevo\n')

    // Rutas hostiles directo al canal: main las rechaza y no toca nada.
    const results = await a.page.evaluate(
      async ({ cwd, out }) => {
        const git = (window as unknown as { api: { code: { git: { discard(c: string, p: string[]): Promise<unknown> } } } }).api.code.git
        const bad = [out, '../x.txt', '.git/config', '/etc/hosts']
        return Promise.all(
          bad.map((p) =>
            git.discard(cwd, [p]).then(
              () => 'aceptada',
              (e: Error) => e.message
            )
          )
        )
      },
      { cwd: repo, out: outside }
    )
    for (const r of results) expect(r).not.toBe('aceptada')
    expect(readFileSync(outside, 'utf8')).toBe('fuera del repo\n')
  })
})
