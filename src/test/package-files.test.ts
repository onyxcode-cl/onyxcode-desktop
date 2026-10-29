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

/**
 * El servidor MCP de `bgshell` es un `.cjs` GENERADO (`scripts/build-shell-bg.mjs`): tiene que generarse en `build`/`dev`, no
 * versionarse y viajar FUERA del .asar (Node no ejecuta un script de dentro), y `verify:bundled` tiene que comprobarlo.
 */
describe('bgshell: servidor MCP empaquetado', () => {
  const root = resolve(__dirname, '../..')
  const read = (f: string): string => readFileSync(resolve(root, f), 'utf8')
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('lo generan build y dev (antes de empaquetar)', () => {
    expect(pkg.scripts['build:shell-bg']).toBe('node scripts/build-shell-bg.mjs')
    expect(pkg.scripts.build).toContain('npm run build:shell-bg')
    expect(pkg.scripts.dev).toContain('npm run build:shell-bg')
    // `package` y `package:win` pasan por `npm run build`.
    expect(pkg.scripts.package).toContain('npm run build')
    expect(pkg.scripts['package:win']).toContain('npm run build')
  })
  it('sale del asar (asarUnpack) y no se versiona', () => {
    const cfg = read('electron-builder.js')
    const unpack = /asarUnpack:\s*\[([\s\S]*?)\n  \]/.exec(cfg)?.[1] ?? ''
    expect(unpack).toContain("'resources/shell-bg/**'")
    expect(read('.gitignore')).toMatch(/^resources\/shell-bg\/$/m)
  })
  it('el script escribe donde asarUnpack y bundledShellBgPath() esperan', () => {
    expect(read('scripts/build-shell-bg.mjs')).toContain("'resources/shell-bg/shell-bg-mcp.cjs'")
    expect(read('src/main/opencode/shell-bg-bundled.ts')).toContain("join('resources', 'shell-bg', 'shell-bg-mcp.cjs')")
  })
  it('verify:bundled comprueba el archivo dentro de app.asar.unpacked', () => {
    expect(read('scripts/verify-bundled.mjs')).toContain('app.asar.unpacked/resources/shell-bg/shell-bg-mcp.cjs')
  })
})

/** El motor de presentaciones del Chat para las Tareas: otro `.cjs` GENERADO, dentro de la skill `pptx` (ya sale del asar con las skills). */
describe('skill pptx: motor de presentaciones del Chat empaquetado', () => {
  const root = resolve(__dirname, '../..')
  const read = (f: string): string => readFileSync(resolve(root, f), 'utf8')
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('lo generan build y dev, y no se versiona', () => {
    expect(pkg.scripts['build:chat-deck']).toBe('node scripts/build-chat-deck.mjs')
    expect(pkg.scripts.build).toContain('npm run build:chat-deck')
    expect(pkg.scripts.dev).toContain('npm run build:chat-deck')
    expect(read('.gitignore')).toMatch(/^resources\/opencode\/skills\/pptx\/scripts\/build_chat_deck\.cjs$/m)
  })
  it('escribe dentro de las skills (asarUnpack) y verify:bundled lo comprueba', () => {
    expect(read('scripts/build-chat-deck.mjs')).toContain("'resources/opencode/skills/pptx/scripts/build_chat_deck.cjs'")
    const unpack = /asarUnpack:\s*\[([\s\S]*?)\n  \]/.exec(read('electron-builder.js'))?.[1] ?? ''
    expect(unpack).toContain("'resources/opencode/skills/**'")
    expect(read('scripts/verify-bundled.mjs')).toContain('skills/pptx/scripts/build_chat_deck.cjs')
  })
})
