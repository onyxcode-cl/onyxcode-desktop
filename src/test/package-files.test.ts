import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Qué NO entra en el paquete de la app. Una vez el instalador de Mac llevó dentro `.claude/worktrees` (17 600 archivos de copias de
 * trabajo de agentes, +55 MB): electron-builder empaqueta lo que hay en disco, no solo lo versionado.
 */
describe('electron-builder: archivos que nunca van en el paquete', () => {
  const cfg = readFileSync(resolve(__dirname, '../../electron-builder.js'), 'utf8')

  it.each(['!.claude/**', '!src/*', '!e2e/**', '!scripts/**', '!docs/**', '!**/__pycache__/**', '!**/*.pyc'])('excluye %s', (glob) => {
    expect(cfg).toContain(`'${glob}'`)
  })
})
