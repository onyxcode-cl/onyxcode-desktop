import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appRuntimeBins, installRuntimes, runtimesStatus, type RuntimeDeps } from './runtime-install'
import { parseRuntimePin } from './runtime-pin'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-runtime-win-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function fixture(): Promise<RuntimeDeps> {
  const raw = JSON.parse(readFileSync(join(__dirname, '../../../resources/runtimes/pin.json'), 'utf8'))
  const node = new JSZip()
  // La distribución oficial de Node trae una carpeta superior; uv trae los ejecutables en la raíz.
  const top = `node-v${raw.node.version}-win-x64/`
  for (const file of ['node.exe', 'npm.cmd', 'npx.cmd', 'node_modules/npm/bin/npm-cli.js', 'node_modules/npm/bin/npx-cli.js'])
    node.file(top + file, `doble de ${file}`)
  const uv = new JSZip().file('uv.exe', 'doble de uv').file('uvx.exe', 'doble de uvx')
  const archives = { node: await node.generateAsync({ type: 'nodebuffer' }), uv: await uv.generateAsync({ type: 'nodebuffer' }) }
  for (const id of ['node', 'uv'] as const) {
    const a = raw[id].assets['win32-x64']
    a.size = archives[id].length
    a.sha256 = createHash('sha256').update(archives[id]).digest('hex')
  }
  const pin = parseRuntimePin(raw)
  expect(pin).not.toBeNull()
  return {
    runtimesDir: join(root, 'runtimes'),
    pin,
    platform: 'win32',
    arch: 'x64',
    freeBytes: async () => 1e9,
    fetch: async (url) => new Response(new Uint8Array(url.includes('nodejs.org') ? archives.node : archives.uv)),
    run: vi.fn(async (bin, args, env) => {
      expect(args).toEqual(['--version'])
      expect(env.PATH.split(';')[0]).toBe(dirname(bin))
      return { code: 0, output: bin.endsWith('node.exe') ? `v${pin!.node.version}` : `uv ${pin!.uv.version}` }
    })
  }
}

describe('instalación Windows con ZIP y procesos dobles (sin red)', () => {
  it('usa strip/into del pin real y deja node.exe, npm.cmd, npx.cmd y uv.exe en sus carpetas', async () => {
    const d = await fixture()
    expect(runtimesStatus(d).missingBytes).toBe(d.pin!.node.assets['win32-x64'].size + d.pin!.uv.assets['win32-x64'].size)
    const st = await installRuntimes(d)
    expect(st.ready).toBe(true)
    const bins = appRuntimeBins(d)
    const nodeDir = join(d.runtimesDir, `node-${d.pin!.node.version}`)
    expect(bins.node).toBe(join(nodeDir, 'node.exe'))
    expect(bins.npmCli).toBe(join(nodeDir, 'node_modules/npm/bin/npm-cli.js'))
    for (const cmd of ['node.exe', 'npm.cmd', 'npx.cmd']) expect(existsSync(join(nodeDir, cmd))).toBe(true)
    expect(bins.uv).toBe(join(d.runtimesDir, `uv-${d.pin!.uv.version}`, 'bin/uv.exe'))
    expect(d.run).toHaveBeenCalledTimes(2)
  })
  it.each(['sha256', 'size'] as const)('rechaza un ZIP que no coincide con %s antes de ejecutar', async (field) => {
    const d = await fixture()
    const a = d.pin!.node.assets['win32-x64']
    if (field === 'sha256') a.sha256 = '0'.repeat(64)
    else a.size += 1
    await expect(installRuntimes(d)).rejects.toMatchObject({ code: 'hash' })
    expect(d.run).not.toHaveBeenCalled()
    expect(appRuntimeBins(d).node).toBeNull()
  })
})
