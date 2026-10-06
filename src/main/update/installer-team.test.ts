/** UPDATE_TEAM_ID (F8-B70): vacío = igual que hoy; con valor, la app descargada debe estar firmada por ese equipo. Sin red ni disco real. */
import { describe, expect, it } from 'vitest'
import { InstallError, UpdateInstaller, type InstallerFs, type RunFn } from './installer'
import { UPDATE_TEAM_ID } from './config'
import type { UpdateManifest } from '@shared/update-install'

const APP_ID = 'cl.x.lazunox'
const fs: InstallerFs = {
  mkdirp: async () => undefined,
  rmrf: async () => undefined,
  openWrite: async () => ({ write: async () => undefined, close: async () => undefined }),
  lstat: async () => ({ isFile: false, isDirectory: true, isSymlink: false }),
  readdir: async () => [],
  readlink: async () => '',
  realpath: async (p) => p,
  freeBytes: async () => 1e12
}
const manifest: UpdateManifest = {
  schema: 1,
  appId: APP_ID,
  version: '0.4.0',
  tag: 'v0.4.0',
  platform: 'darwin-arm64',
  keyId: 'k',
  publishedAt: '',
  zip: { name: 'x', size: 1, sha256: 'a' }
}

function make(opts: { teamId?: string; teamOk?: boolean }): { inst: UpdateInstaller; calls: string[][] } {
  const calls: string[][] = []
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === '/usr/bin/codesign' && args[0] === '--verify') {
      const isTeamCheck = args.some((a) => a.startsWith('-R='))
      return { code: isTeamCheck && opts.teamOk === false ? 3 : 0, stdout: '', stderr: '' }
    }
    if (cmd === '/usr/bin/codesign') return { code: 0, stdout: '', stderr: `Identifier=${APP_ID}\n` }
    if (args.includes('CFBundleIdentifier')) return { code: 0, stdout: APP_ID, stderr: '' }
    return { code: 0, stdout: '0.4.0', stderr: '' }
  }
  const inst = new UpdateInstaller({
    fetch: async () => new Response(''),
    run,
    fs,
    userData: '/tmp/x',
    appId: APP_ID,
    currentVersion: '0.3.0',
    repo: 'o/r',
    downloadBase: 'https://github.com',
    allowLoopbackHttp: false,
    keys: [],
    userAgent: 'test',
    teamId: opts.teamId,
    onState: () => undefined
  })
  return { inst, calls }
}

describe('UPDATE_TEAM_ID', () => {
  it('la constante por defecto está vacía (no cambia nada hasta tener el certificado)', () => {
    expect(UPDATE_TEAM_ID).toBe('')
  })

  it('vacío: no se ejecuta ningún requisito de equipo', async () => {
    const { inst, calls } = make({ teamId: '' })
    await inst.verifyApp('/s/Lazunox.app', manifest)
    expect(calls.some((c) => c.some((a) => a.startsWith('-R=')))).toBe(false)
  })

  it('con valor: exige el requisito exacto de OU del certificado hoja', async () => {
    const { inst, calls } = make({ teamId: 'ABCDE12345' })
    await inst.verifyApp('/s/Lazunox.app', manifest)
    const rq = calls.find((c) => c.some((a) => a.startsWith('-R=')))!
    expect(rq).toEqual([
      '/usr/bin/codesign',
      '--verify',
      '--strict',
      '-R=anchor apple generic and certificate leaf[subject.OU] = "ABCDE12345"',
      '/s/Lazunox.app'
    ])
  })

  it('con valor: rechaza una app firmada por otra identidad', async () => {
    const { inst } = make({ teamId: 'ABCDE12345', teamOk: false })
    await expect(inst.verifyApp('/s/Lazunox.app', manifest)).rejects.toMatchObject({ code: 'signing' })
    await expect(inst.verifyApp('/s/Lazunox.app', manifest)).rejects.toBeInstanceOf(InstallError)
  })

  it('un valor mal formado falla cerrado y nunca llega a codesign', async () => {
    for (const bad of ['abc', 'ABCDE1234"', 'ABCDE12345 or true']) {
      const { inst, calls } = make({ teamId: bad })
      await expect(inst.verifyApp('/s/Lazunox.app', manifest)).rejects.toMatchObject({ code: 'signing' })
      expect(calls.some((c) => c.some((a) => a.startsWith('-R=')))).toBe(false)
    }
  })
})
