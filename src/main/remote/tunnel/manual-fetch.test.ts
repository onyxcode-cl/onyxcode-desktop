/**
 * Regresión del fallo real «Redirect was cancelled»: `net.fetch(url, { redirect: 'manual' })` de Electron LANZA ante la primera
 * redirección (GitHub redirige la release a `release-assets.githubusercontent.com`), así que la descarga de `cloudflared` fallaba al
 * instante con `BinaryError('download')`. `createManualFetch` usa `net.request` (evento `redirect`) y devuelve cada salto como una
 * `Response` 3xx para que `CloudflaredBinary` lo valide. Aquí `net.request` es un doble que se comporta como el de Electron: tras el
 * evento `redirect` la petición queda esperando a que se decida (no sigue sola) y solo la cierra `abort()`.
 */
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { macOnly } from '../../../test/platform'
import { BinaryError, CloudflaredBinary, realRun, type CloudflaredPin, type RunFile } from './binary'
import { createManualFetch, type NetLike } from './manual-fetch'

const mit = it.skipIf(!macOnly)

type Route =
  { redirect: string; status?: number } | { body: Buffer; status?: number; headers?: Record<string, string | string[]> } | { error: string }

/** Doble de `net.request` de Electron con `redirect: 'manual'`. */
function fakeNet(routes: Record<string, Route>): { net: NetLike; requested: string[]; aborted: string[]; followed: string[] } {
  const requested: string[] = []
  const aborted: string[] = []
  const followed: string[] = []
  const net: NetLike = {
    request(opts) {
      requested.push(opts.url)
      expect(opts.redirect).toBe('manual')
      const em = new EventEmitter()
      let dead = false
      const req = Object.assign(em, {
        end() {
          setTimeout(() => {
            if (dead) return
            const r = routes[opts.url]
            if (!r) {
              em.emit('error', new Error(`ERR_NAME_NOT_RESOLVED ${opts.url}`))
              return
            }
            if ('error' in r) {
              em.emit('error', new Error(r.error))
              return
            }
            if ('redirect' in r) {
              em.emit('redirect', r.status ?? 302, 'GET', r.redirect, { location: [r.redirect] })
              return
            }
            const res = Object.assign(new EventEmitter(), { statusCode: r.status ?? 200, headers: r.headers ?? {} })
            em.emit('response', res)
            // Entrega por trozos.
            const half = Math.ceil(r.body.length / 2)
            setTimeout(() => {
              if (dead) return
              res.emit('data', r.body.subarray(0, half))
              res.emit('data', r.body.subarray(half))
              res.emit('end')
            }, 1)
          }, 1)
        },
        abort() {
          dead = true
          aborted.push(opts.url)
        },
        followRedirect() {
          followed.push(opts.url)
        }
      })
      return req as never
    }
  }
  return { net, requested, aborted, followed }
}

const A = 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/cloudflared-darwin-arm64.tgz'
const B = 'https://release-assets.githubusercontent.com/github-production-release-asset/abc/def?sig=1&x=2'

describe('createManualFetch', () => {
  it('una redirección se devuelve como 3xx con Location, se aborta la petición y NUNCA se sigue sola', async () => {
    const f = fakeNet({ [A]: { redirect: B } })
    const res = await createManualFetch(f.net)(A, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(B)
    expect(f.aborted).toEqual([A])
    expect(f.followed).toEqual([])
    expect(f.requested).toEqual([A])
  })
  it('una respuesta 200 llega entera y con sus cabeceras', async () => {
    const body = Buffer.from('x'.repeat(1000))
    const f = fakeNet({ [B]: { body, headers: { 'content-length': '1000', 'content-type': ['application/octet-stream'] } } })
    const res = await createManualFetch(f.net)(B, { redirect: 'manual' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1000')
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true)
  })
  it('un fallo de red rechaza (quien llama lo convierte en `download`)', async () => {
    const f = fakeNet({ [A]: { error: 'net::ERR_INTERNET_DISCONNECTED' } })
    await expect(createManualFetch(f.net)(A, { redirect: 'manual' })).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/)
  })
  it('una señal ya abortada o que se aborta cancela la petición', async () => {
    const f = fakeNet({ [A]: { body: Buffer.from('x') } })
    const ac = new AbortController()
    ac.abort()
    await expect(createManualFetch(f.net)(A, { redirect: 'manual', signal: ac.signal })).rejects.toThrow('aborted')
    expect(f.aborted).toEqual([A])
  })
  it('una 3xx que llegara como respuesta (sin evento) tampoco expone cuerpo', async () => {
    const f = fakeNet({ [A]: { body: Buffer.from('evil'), status: 301, headers: { location: B } } })
    const res = await createManualFetch(f.net)(A, { redirect: 'manual' })
    expect(res.status).toBe(301)
    expect(res.body).toBeNull()
  })
})

describe('CloudflaredBinary.install con la redirección real de GitHub', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'onyx-mf-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const BIN = Buffer.from('#!/bin/sh\necho fake\n'.repeat(30))
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
  const SIG = { identifier: 'cloudflared', teamId: 'ABCDE12345', authority: 'Developer ID Application: Fake Inc. (ABCDE12345)' }
  function tgz(): Buffer {
    writeFileSync(join(dir, 'cloudflared'), BIN)
    execFileSync('/usr/bin/tar', ['-czf', join(dir, 'x.tgz'), '-C', dir, 'cloudflared'])
    return readFileSync(join(dir, 'x.tgz'))
  }
  const pinOf = (t: Buffer): CloudflaredPin => ({
    version: '2026.9.3',
    releasedAt: '2026-09-24',
    assets: {
      'darwin-arm64': {
        url: A,
        size: t.length,
        sha256: sha(t),
        binSize: BIN.length,
        binSha256: sha(BIN),
        binMaxSize: 80_000_000,
        signature: SIG
      }
    }
  })
  const run: RunFile = async (file, args, opts) => {
    if (file === '/usr/bin/codesign')
      return {
        stdout: '',
        stderr: args[0] === '-d' ? `Identifier=cloudflared\nAuthority=${SIG.authority}\nTeamIdentifier=${SIG.teamId}\n` : ''
      }
    return realRun(file, args, opts)
  }
  const make = (t: Buffer, net: NetLike): CloudflaredBinary =>
    new CloudflaredBinary({
      pin: pinOf(t),
      binDir: join(dir, 'bin'),
      platform: 'darwin',
      arch: 'arm64',
      fetch: createManualFetch(net),
      run
    })

  mit('descarga github.com → 302 → release-assets.githubusercontent.com y la instala', async () => {
    const t = tgz()
    const f = fakeNet({ [A]: { redirect: B }, [B]: { body: t, headers: { 'content-length': String(t.length) } } })
    const path = await make(t, f.net).install({ consent: true })
    expect(readFileSync(path).equals(BIN)).toBe(true)
    expect(f.requested).toEqual([A, B])
  })
  mit('una redirección a un host fuera de la lista cerrada NO se pide (ni una petición al host ajeno)', async () => {
    const t = tgz()
    const evil = 'https://evil.example/cloudflared.tgz'
    const f = fakeNet({ [A]: { redirect: evil }, [evil]: { body: t } })
    await expect(make(t, f.net).install({ consent: true })).rejects.toMatchObject({ code: 'download' })
    expect(f.requested).toEqual([A])
  })
  mit('redirecciones por http, con puerto o con credenciales se rechazan', async () => {
    const t = tgz()
    for (const bad of [
      'http://release-assets.githubusercontent.com/x',
      'https://release-assets.githubusercontent.com:8443/x',
      'https://u:p@release-assets.githubusercontent.com/x'
    ]) {
      const f = fakeNet({ [A]: { redirect: bad }, [bad]: { body: t } })
      await expect(make(t, f.net).install({ consent: true })).rejects.toBeInstanceOf(BinaryError)
      expect(f.requested).toEqual([A])
    }
  })
  mit('el SHA-256 fijado sigue mandando: un cuerpo distinto tras la redirección es `bad-hash`', async () => {
    const t = tgz()
    const wrong = Buffer.from(t)
    wrong[wrong.length - 20] ^= 0xff
    const f = fakeNet({ [A]: { redirect: B }, [B]: { body: wrong } })
    await expect(make(t, f.net).install({ consent: true })).rejects.toMatchObject({ code: 'bad-hash' })
  })
})
