// Calidad R3-B: descartar conservando lo preparado y descartar un bloque (hunk) desde el diff, con un repo temporal REAL
// (git de verdad). Capturas con R3B_SHOTS_DIR (claro/oscuro, 820/1280 px).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useApp } from '../lib/harness'
import { MODE } from '../lib/launch'
import { shot } from '../lib/shots'
import { expectCount, expectVisible } from '../lib/wait'
import { makeGitRepo, openCodeProject } from '../lib/fase6'

const SHOTS = process.env.R3B_SHOTS_DIR
const trashDir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-e2e-r3b-trash-')))
let repo = ''
const numbered = (edit: Record<number, string> = {}): string =>
  Array.from({ length: 60 }, (_, i) => edit[i + 1] ?? `linea ${i + 1}`).join('\n') + '\n'

describe.skipIf(MODE === 'prod')(`calidad R3-B: descartar bloque y conservar lo preparado (${MODE})`, () => {
  beforeAll(() => {
    repo = makeGitRepo('onyx-e2e-r3b-')
    writeFileSync(join(repo, 'big.txt'), numbered())
    git('add', 'big.txt')
    git('commit', '-q', '-m', 'big')
  })
  const app = useApp({ env: { ONYXCODE_E2E_TRASH_DIR: trashDir } })
  afterAll(async () => {
    // Los afterAll corren en orden inverso: se para la app antes de borrar (Windows: EBUSY si un proceso aún tiene la carpeta como cwd).
    await app().stop().catch(() => undefined)
    rmSync(trashDir, { recursive: true, force: true })
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  })
  const git = (...a: string[]): string => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' })
  const read = (rel: string): string => readFileSync(join(repo, rel), 'utf8')

  it('un bloque del diff: confirmar, quitarlo sin tocar lo preparado ni el otro bloque, y «Deshacer»', async () => {
    const a = app()
    // Preparado: línea 3. Sin preparar: líneas 30 y 55 (dos bloques separados).
    writeFileSync(join(repo, 'big.txt'), numbered({ 3: 'TRES' }))
    git('add', 'big.txt')
    writeFileSync(join(repo, 'big.txt'), numbered({ 3: 'TRES', 30: 'TREINTA', 55: 'CINCUENTA Y CINCO' }))
    await openCodeProject(a, repo)
    const changes = a.page.getByRole('button', { name: 'Cambios', exact: true })
    if ((await changes.first().getAttribute('aria-pressed')) !== 'true') await changes.first().click()
    await a.page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    // La fila de «No preparados» (la de «Preparados» también se llama big.txt): se elige la segunda sección.
    const rows = a.page.getByRole('button', { name: /big\.txt/ }).filter({ hasText: 'big.txt' })
    await expectVisible(rows.first(), 20_000)
    await rows.last().click()
    const hunkBtn = a.page.getByRole('button', { name: 'Descartar este bloque' })
    await expectCount(hunkBtn, 2)
    await shot(a, SHOTS, 'diff-con-bloques')
    await hunkBtn.first().click()
    const dialog = a.page.getByRole('alertdialog')
    await expectVisible(dialog.getByText('¿Descartar este bloque de big.txt?'))
    await shot(a, SHOTS, 'confirmar-descartar-bloque')
    // Cancelar no toca nada.
    await dialog.getByRole('button', { name: 'Cancelar' }).click()
    expect(read('big.txt')).toBe(numbered({ 3: 'TRES', 30: 'TREINTA', 55: 'CINCUENTA Y CINCO' }))
    // Confirmar.
    await hunkBtn.first().click()
    await a.page.getByRole('alertdialog').getByRole('button', { name: 'Descartar', exact: true }).click()
    await expectVisible(a.page.getByText('Bloque descartado.'))
    expect(read('big.txt')).toBe(numbered({ 3: 'TRES', 55: 'CINCUENTA Y CINCO' }))
    expect(git('show', ':big.txt')).toBe(numbered({ 3: 'TRES' })) // lo preparado intacto
    await shot(a, SHOTS, 'bloque-descartado')
    await a.page.getByRole('button', { name: 'Deshacer', exact: true }).click()
    await expectVisible(a.page.getByText('Cambios recuperados.'))
    expect(read('big.txt')).toBe(numbered({ 3: 'TRES', 30: 'TREINTA', 55: 'CINCUENTA Y CINCO' }))
    expect(git('show', ':big.txt')).toBe(numbered({ 3: 'TRES' }))
  })

  it('descartar desde «No preparados» conserva lo preparado; un bloque obsoleto o ruta hostil la rechaza main', async () => {
    const a = app()
    await a.page.getByRole('button', { name: 'Actualizar', exact: true }).click()
    const rows = a.page.getByRole('button', { name: /big\.txt/ }).filter({ hasText: 'big.txt' })
    await expectVisible(rows.first(), 20_000)
    const before = read('big.txt')
    // Canal directo: bloque que no corresponde, ruta fuera del repo y .git se rechazan sin tocar nada.
    const results = await a.page.evaluate(
      async ({ cwd }) => {
        const g = (
          window as unknown as { api: { code: { git: { discardHunk(c: string, p: string, i: number, h: string): Promise<unknown> } } } }
        ).api.code.git
        const tries: Array<[string, number, string]> = [
          ['big.txt', 0, '@@ -1 +1 @@\n-x\n+y\n'],
          ['../x.txt', 0, '@@ -1 +1 @@\n-x\n+y\n'],
          ['.git/config', 0, '@@ -1 +1 @@\n-x\n+y\n']
        ]
        return Promise.all(
          tries.map(([p, i, h]) =>
            g.discardHunk(cwd, p, i, h).then(
              () => 'aceptada',
              (e: Error) => e.message
            )
          )
        )
      },
      { cwd: repo }
    )
    for (const r of results) expect(r).not.toBe('aceptada')
    expect(read('big.txt')).toBe(before)
    // Descartar el archivo desde la fila de «No preparados»: el árbol vuelve a lo preparado, que se conserva.
    const row = a.page.getByRole('button', { name: 'Descartar los cambios de big.txt' })
    await row.last().click({ force: true })
    const dialog = a.page.getByRole('alertdialog')
    await expectVisible(dialog.getByText('se conserva', { exact: false }))
    await shot(a, SHOTS, 'confirmar-descartar-conserva-preparado')
    await dialog.getByRole('button', { name: 'Descartar', exact: true }).click()
    await expectVisible(a.page.getByText('1 archivo restaurado.'))
    expect(read('big.txt')).toBe(numbered({ 3: 'TRES' }))
    expect(git('status', '--porcelain')).toBe('M  big.txt\n')
  })
})
