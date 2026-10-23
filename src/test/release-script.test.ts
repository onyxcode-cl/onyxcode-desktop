/**
 * Pruebas de scripts/release.sh (release por fases). Todo con --dry-run o con rechazos previos: no empaqueta, no firma, no usa la red
 * ni toca claves. `gh` es un falso que solo anota sus llamadas (así se comprueba que `publish` nunca llega a `release edit` sin una persona).
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const script = join(root, 'scripts', 'release.sh')
const isMac = process.platform === 'darwin'
let tmp = ''
let ghLog = ''

function run(args: string[], input?: string): { code: number; out: string } {
  const r = spawnSync('bash', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    input: input ?? '',
    env: {
      ...process.env,
      PATH: `${tmp}:${process.env.PATH}`,
      ONYX_WIN_HOST: 'Prueba@192.0.2.1',
      LAZUNOX_UPDATE_KEY_FILE: join(tmp, 'no-existe.pem')
    },
    timeout: 60_000
  })
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}

const calls = (): string => (existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '')

// El script es de macOS (usa sed -i '', ditto, shasum): se prueba donde corre la release.
describe.skipIf(!isMac)('scripts/release.sh', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lazunox-release-test-'))
    ghLog = join(tmp, 'gh.log')
    writeFileSync(join(tmp, 'gh'), `#!/bin/sh\necho "$*" >> "${ghLog}"\nexit 0\n`)
    chmodSync(join(tmp, 'gh'), 0o755)
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('rechaza fase o versión no válidas', () => {
    // Con la salida del script como mensaje: si falla en otro entorno (CI), se ve POR QUÉ salió con otro código.
    for (const args of [['volar', '0.5.35'], ['prepare', 'abc'], ['mac'], ['--nada', 'mac', '0.5.35']]) {
      const r = run(args)
      expect(r.code, `release.sh ${args.join(' ')} → ${r.out.slice(0, 400)}`).toBe(2)
    }
  })

  it('--dry-run mac imprime la cadena completa y en orden, con verify:bundled DESPUÉS de publish-update', () => {
    const { code, out } = run(['--dry-run', 'mac', '0.5.35'])
    expect(code).toBe(0)
    const order = [
      'npm run package',
      'sign-release-mac.sh',
      'publish-update.mjs --out dist/update',
      'verify-update.mjs --dir dist/update',
      'verify:bundled',
      'smoke-boot-mac.sh'
    ]
    let at = -1
    for (const frag of order) {
      const i = out.indexOf(frag, at + 1)
      expect(i, frag).toBeGreaterThan(at)
      at = i
    }
  })

  it('--dry-run win usa el host por entorno y encadena sync, publish, verify y pack-check', () => {
    const { code, out } = run(['--dry-run', 'win', '0.5.35'])
    expect(code).toBe(0)
    expect(out).toContain('Prueba@192.0.2.1')
    for (const frag of ['scripts/win/sync.sh', '--platform win32-x64', 'verify-update.mjs --platform win32-x64', 'pack-check.ps1'])
      expect(out).toContain(frag)
  })

  it('el host de Windows por defecto es el de Tailscale', () => {
    expect(readFileSync(script, 'utf8')).toContain('ONYX_WIN_HOST:-Bentec@100.64.0.6')
  })

  it('--dry-run draft y publish solo imprimen y no llaman a gh release create/edit', () => {
    const d = run(['--dry-run', 'draft', '0.5.35'])
    expect(d.out).toContain('gh release create v0.5.35')
    expect(d.out).toContain('--draft')
    const p = run(['--dry-run', 'publish', '0.5.35'])
    expect(p.code, `release.sh --dry-run publish → ${p.out.slice(0, 400)}`).toBe(0)
    expect(p.out).toContain('publicar v0.5.35')
    expect(p.out).toContain('Purgar Cloudflare')
    expect(calls()).not.toMatch(/release (create|edit)/)
  })

  it('publish sin terminal interactivo no publica aunque se le pase la frase por la entrada', () => {
    writeFileSync(join(tmp, 'gh'), `#!/bin/sh\necho "$*" >> "${ghLog}"\ncase "$*" in *isDraft*) echo true;; esac\nexit 0\n`)
    const r = run(['publish', '0.5.35'], 'publicar v0.5.35\n')
    expect(r.code).not.toBe(0)
    expect(calls()).not.toMatch(/release edit/)
  })

  it('el script exige TTY y la frase exacta antes de gh release edit', () => {
    const src = readFileSync(script, 'utf8')
    const iTty = src.indexOf('[ -t 0 ] && [ -t 1 ]')
    const iPhrase = src.indexOf('[ "$reply" = "$phrase" ]')
    const iEdit = src.indexOf('run gh release edit')
    expect(iTty).toBeGreaterThan(0)
    expect(iPhrase).toBeGreaterThan(iTty)
    expect(iEdit).toBeGreaterThan(iPhrase)
    expect(src).not.toMatch(/--yes|--no-confirm/)
  })

  it('no lee ni imprime las claves', () => {
    expect(readFileSync(script, 'utf8')).not.toMatch(/cat\s+["$]*\{?(KEY_FILE|DEPLOY_KEY)|cat .*\.pem/)
  })
})
