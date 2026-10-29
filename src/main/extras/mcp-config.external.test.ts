import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { readExternalMcpServers, stripJsonc } from './mcp-config'

let dir: string
let saved: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-xdg-'))
  saved = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  mkdirSync(join(dir, 'opencode'), { recursive: true })
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
  rmSync(dir, { recursive: true, force: true })
})

describe('stripJsonc', () => {
  it('quita comentarios y comas finales sin tocar las cadenas con // o /*', () => {
    const txt = '{ // nota\n "url": "https://x.cl/mcp/", /* b */ "a": "/* no */", "l": [1,2,], }'
    expect(JSON.parse(stripJsonc(txt))).toEqual({ url: 'https://x.cl/mcp/', a: '/* no */', l: [1, 2] })
  })
})

describe('readExternalMcpServers', () => {
  it('lee los conectores de la config global de OpenCode (jsonc) sin modificarla', () => {
    const file = join(dir, 'opencode', 'opencode.jsonc')
    const body = `{
  // conectores míos
  "mcp": {
    "crm": { "type": "remote", "url": "https://crm.example.cl/mcp/", "headers": { "Authorization": "Bearer abc" } },
    "roto": { "type": "remote", "url": "no-es-url" },
    "gmail": { "type": "local", "command": ["npx", "-y", "x"], "environment": { "K": "v" } },
  }
}`
    writeFileSync(file, body)
    const out = readExternalMcpServers()
    expect(Object.keys(out).sort()).toEqual(['crm', 'gmail'])
    expect(out.crm).toMatchObject({ type: 'remote', url: 'https://crm.example.cl/mcp/', headers: { Authorization: 'Bearer abc' } })
  })

  it('sin archivo o con basura devuelve vacío', () => {
    expect(readExternalMcpServers()).toEqual({})
    writeFileSync(join(dir, 'opencode', 'opencode.json'), '{ esto no es json')
    expect(readExternalMcpServers()).toEqual({})
  })
})
