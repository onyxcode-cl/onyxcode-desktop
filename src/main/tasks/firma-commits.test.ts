// F8-B198: la firma de los commits de las tareas es la MISMA en macOS (variables GIT_* del sandbox) y en Windows (/etc/gitconfig de la imagen de WSL).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { SANDBOX_GIT_EMAIL, SANDBOX_GIT_NAME } from './sandbox-profile'

const customize = readFileSync(resolve(__dirname, '../../../scripts/wsl-rootfs/customize.sh'), 'utf8')

const printfLine = customize.split('\n').find((l) => l.startsWith('printf') && l.includes('/etc/gitconfig"'))

describe('firma de commits de las tareas', () => {
  it('la imagen de WSL fija en /etc/gitconfig la misma identidad que el sandbox de macOS', () => {
    expect(printfLine, 'falta el printf de /etc/gitconfig en customize.sh').toBeTruthy()
    expect(printfLine).toContain(`name = ${SANDBOX_GIT_NAME}`)
    expect(printfLine).toContain(`email = ${SANDBOX_GIT_EMAIL}`)
  })

  it('la identidad no lleva datos personales (dominio .invalid) ni el nombre de ningún equipo', () => {
    expect(SANDBOX_GIT_EMAIL).toMatch(/@[a-z]+\.invalid$/)
    expect(printfLine).not.toMatch(/localdomain|\$\(hostname\)|\$HOSTNAME/)
  })

  it.skipIf(!posixOnly)('lo que escribe customize.sh es una configuración válida de git y da esa firma (git real, HOME temporal)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-gitid-'))
    try {
      // Mismo texto que escribe el printf de customize.sh, interpretado por el shell.
      const cfg = join(dir, 'gitconfig')
      execFileSync('sh', ['-c', `printf '[user]\\n\\tname = ${SANDBOX_GIT_NAME}\\n\\temail = ${SANDBOX_GIT_EMAIL}\\n' > "$1"`, 'sh', cfg])
      const out = execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '',
          HOME: dir,
          GIT_CONFIG_SYSTEM: cfg,
          GIT_CONFIG_GLOBAL: join(dir, 'vacio'),
          XDG_CONFIG_HOME: dir
        }
      })
      expect(out.startsWith(`${SANDBOX_GIT_NAME} <${SANDBOX_GIT_EMAIL}> `)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
