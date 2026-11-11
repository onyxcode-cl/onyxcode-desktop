/**
 * Seatbelt REAL (`sandbox-exec`): los ganchos de git (`**\/.git/hooks`) de la carpeta de la tarea no se pueden crear, cambiar ni volver
 * ejecutables desde dentro (1.8.19). Esos ganchos los ejecuta FUERA de la jaula quien use git en la carpeta. Y git sigue funcionando
 * dentro (`init`, `config` local, `add`, `commit`, `clone`), gracias a `GIT_TEMPLATE_DIR` vacío de `sandboxEnv`.
 * Idea: sandbox-runtime de Anthropic y Codex (los dos protegen `.git/hooks`); regla y pruebas propias. Archivos de prueba en una carpeta
 * temporal. Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { buildSandboxProfile, sandboxDirs, sandboxEnv, type SandboxProfileOptions } from './sandbox-profile'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')
const BUILDERS: Array<[string, (o: SandboxProfileOptions) => string]> = [['V1', buildSandboxProfile]]

describe.skipIf(!HAS_SBX).each(BUILDERS)('Seatbelt real (%s): ganchos de git en la carpeta de la tarea', (_j, build) => {
  let dir: string
  let folder: string
  let privateDir: string

  beforeAll(() => {
    // Fuera del temporal del usuario (la jaula V2 no deja leerlo).
    dir = realpathSync(mkdtempSync('/private/tmp/lazunox-githooks-'))
    folder = join(dir, 'tarea')
    privateDir = join(dir, 'ud', 'tasks-sandbox', 'abc')
    for (const d of [join(folder, '.lazunox', 'trabajo'), ...Object.values(sandboxDirs(privateDir))]) mkdirSync(d, { recursive: true })
    // Un repositorio que ya existía (creado fuera, con los ganchos de ejemplo de git).
    spawnSync('/usr/bin/git', ['init', '-q', join(folder, 'previo')])
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const inside = (script: string, allowDelete = true): string => {
    const profile = build({ folder, privateDir, userData: join(dir, 'ud'), home: join(dir, 'home'), allowDelete })
    const env = { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), ...sandboxEnv(sandboxDirs(privateDir)) }
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, '/bin/sh', '-c', script], {
      cwd: folder,
      env,
      encoding: 'utf8',
      timeout: 60000
    })
    return `${r.stdout}${r.stderr}`
  }

  it('git sigue funcionando dentro: init, config local, add, commit, clone (en la carpeta y en .lazunox/trabajo)', () => {
    const out = inside(`set -e
git init -q . && git config user.name Prueba && echo a > a.txt && git add a.txt && git commit -qm uno && echo RAIZ-OK
cd .lazunox/trabajo && git init -q r && cd r && echo x > f && git add f && git commit -qm uno && cd .. && git clone -q r r2 && echo TRABAJO-OK`)
    expect(out).toContain('RAIZ-OK')
    expect(out).toContain('TRABAJO-OK')
    expect(out).not.toContain('templates not found')
  })

  it('desde dentro no se crea, cambia ni se hace ejecutable ningún gancho', () => {
    const sample = join(folder, 'previo', '.git', 'hooks', 'pre-commit.sample')
    chmodSync(sample, 0o644)
    const size = statSync(sample).size
    writeFileSync(join(folder, 'malo'), '#!/bin/sh\n')
    inside(`printf '#!/bin/sh\\n' > .git/hooks/pre-commit
mkdir -p .lazunox/trabajo/r/.git/hooks; printf x > .lazunox/trabajo/r/.git/hooks/pre-commit
cp malo m2; mv m2 previo/.git/hooks/pre-push
ln malo previo/.git/hooks/post-commit
mkdir hk; printf x > hk/pre-commit; ln -s ../hk .lazunox/trabajo/r2/.git/hooks
chmod +x "${sample}"; echo y >> "${sample}"
mv "${sample}" previo/.git/hooks/pre-commit
exit 0`)
    for (const p of [
      join(folder, '.git', 'hooks', 'pre-commit'),
      join(folder, '.lazunox', 'trabajo', 'r', '.git', 'hooks'),
      join(folder, 'previo', '.git', 'hooks', 'pre-push'),
      join(folder, 'previo', '.git', 'hooks', 'post-commit'),
      join(folder, 'previo', '.git', 'hooks', 'pre-commit'),
      join(folder, '.lazunox', 'trabajo', 'r2', '.git', 'hooks')
    ])
      expect(
        existsSync(p) ||
          (() => {
            try {
              return lstatSync(p).isSymbolicLink()
            } catch {
              return false
            }
          })(),
        p
      ).toBe(false)
    expect(statSync(sample).mode & 0o777).toBe(0o644)
    expect(statSync(sample).size).toBe(size)
  })
})
