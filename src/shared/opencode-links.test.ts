import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPENCODE_ACTIONS, OPENCODE_INSTALL_COMMAND, OPENCODE_LINKS, OPENCODE_SDK_VERSION } from './opencode-links'

describe('opencode-links', () => {
  it('la versión del SDK coincide con package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    expect(pkg.devDependencies['@opencode-ai/sdk']).toBe(OPENCODE_SDK_VERSION)
  })
  it('solo hay páginas de opencode.ai en https y cada acción de apertura tiene URL', () => {
    for (const url of Object.values(OPENCODE_LINKS)) expect(url).toMatch(/^https:\/\/opencode\.ai(\/|$)/)
    for (const a of OPENCODE_ACTIONS) if (a !== 'copyInstall') expect(OPENCODE_LINKS[a]).toBeTruthy()
  })
  it('el comando de instalación apunta al instalador oficial', () => {
    expect(OPENCODE_INSTALL_COMMAND).toBe('curl -fsSL https://opencode.ai/install | bash')
  })
})
