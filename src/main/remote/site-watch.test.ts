import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSiteManifest } from '@shared/remote/site-manifest'
import * as updateLib from '../../../scripts/update-lib.mjs'
// @ts-expect-error: script .mjs sin declaración de tipos
import * as siteLib from '../../../scripts/site-lib.mjs'
// @ts-expect-error: script .mjs sin declaración de tipos
import { release } from '../../../scripts/site-release.mjs'
import { SITE_CHECK_EVERY_MS, SITE_RETRY_MS, SiteWatch, type SiteFetch, type SiteResponse, type SiteState } from './site-watch'

const ORIGIN = 'https://remoto.test'
const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex')

interface Site {
  files: Map<string, string>
  headers: Map<string, Record<string, string>>
}

/** Servidor falso: lo que se pide a `ORIGIN/<ruta>` sale de aquí (la raíz `/` es `index.html`). */
function fakeFetch(site: Site, log: string[] = [], failAll = false): SiteFetch {
  return async (url, init) => {
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
    log.push(url)
    if (failAll) throw new Error('sin red')
    const path = url.slice(ORIGIN.length + 1) || 'index.html'
    const body = site.files.get(path)
    const res: SiteResponse = {
      status: body === undefined ? 404 : 200,
      headers: { get: (n) => site.headers.get(path)?.[n.toLowerCase()] ?? null },
      arrayBuffer: async () => new TextEncoder().encode(body ?? '').buffer as ArrayBuffer
    }
    return res
  }
}

const KEY = generateKeyPairSync('ed25519')
const PUB = updateLib.spkiBase64(KEY.publicKey)
const CSP = siteLib.CSP

/** Un sitio publicado correctamente: archivos, manifiesto firmado y la CSP en `index.html`. */
function publish(opts: { seq?: number; keyId?: string; privateKey?: typeof KEY.privateKey; tamper?: (s: Site) => void } = {}): Site {
  const files = new Map<string, string>([
    ['index.html', '<!doctype html><html><head><script type="module" src="./assets/index-AAAA1111.js"></script></head></html>'],
    ['sw.js', "const BUILD = 'abcdef012345'"],
    ['manifest.webmanifest', '{"name":"Lazunox"}'],
    ['assets/index-AAAA1111.js', 'console.log(1)'],
    ['app/assets/main-BBBB2222.js', 'console.log(2)']
  ])
  const manifest = siteLib.buildSiteManifest({
    files: [...files].map(([p, c]) => ({ p, sha256: sha(c) })),
    startup: siteLib.startupPaths(files.get('index.html') as string),
    build: 'abcdef012345',
    version: '0.3.0',
    keyId: opts.keyId ?? 'lazunox-site-1',
    seq: opts.seq ?? 1000,
    csp: CSP,
    publishedAt: '2026-10-04T00:00:00.000Z'
  })
  const bytes = siteLib.siteManifestBytes(manifest)
  files.set('site-manifest.json', bytes.toString('utf8'))
  files.set('site-manifest.sig', updateLib.signBytes(bytes, opts.privateKey ?? KEY.privateKey) + '\n')
  const site: Site = { files, headers: new Map([['index.html', { 'content-security-policy': CSP }]]) }
  opts.tamper?.(site)
  return site
}

function watchOf(site: Site, o: { publicKey?: string; seq?: { v: number }; log?: string[]; failAll?: boolean } = {}) {
  const seq = o.seq ?? { v: 0 }
  const events: Array<[SiteState, SiteState]> = []
  const audits: Array<{ kind: string; why?: string }> = []
  const timers: Array<{ ms: number; fn: () => void; dead: boolean }> = []
  const w = new SiteWatch({
    origin: ORIGIN,
    publicKey: o.publicKey ?? PUB,
    keyId: 'lazunox-site-1',
    fetch: fakeFetch(site, o.log, o.failAll),
    getMinSeq: () => seq.v,
    setMinSeq: (n) => void (seq.v = n),
    onChange: (s, p) => events.push([s, p]),
    audit: (e) => audits.push(e),
    timers: {
      set: (fn, ms) => {
        const t = { ms, fn, dead: false }
        timers.push(t)
        return t
      },
      clear: (h) => void ((h as { dead: boolean }).dead = true)
    }
  })
  return { w, seq, events, audits, timers }
}

describe('SiteWatch: comprobación', () => {
  it('sitio firmado y íntegro: ok, y recuerda el seq', async () => {
    const { w, seq, events, audits } = watchOf(publish({ seq: 1234 }))
    expect(await w.check()).toBe('ok')
    expect(w.paused()).toBe(false)
    expect(seq.v).toBe(1234)
    expect(events).toEqual([['ok', 'unknown']])
    expect(audits).toEqual([])
  })

  it('firma de OTRA clave: mismatch (modo nube en pausa) y queda en la auditoría con motivo fijo', async () => {
    const other = generateKeyPairSync('ed25519')
    const { w, audits } = watchOf(publish({ privateKey: other.privateKey }))
    expect(await w.check()).toBe('mismatch')
    expect(w.paused()).toBe(true)
    expect(audits).toEqual([{ kind: 'site-mismatch', why: 'bad-signature' }])
  })

  it('un archivo del arranque alterado: mismatch', async () => {
    for (const p of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AAAA1111.js']) {
      const { w, audits } = watchOf(publish({ tamper: (s) => s.files.set(p, `${s.files.get(p)} // alterado`) }))
      expect(await w.check(), p).toBe('mismatch')
      expect(audits[0].why).toBe('file-hash')
    }
  })

  it('falta un archivo del arranque: mismatch', async () => {
    const { w, audits } = watchOf(publish({ tamper: (s) => void s.files.delete('assets/index-AAAA1111.js') }))
    expect(await w.check()).toBe('mismatch')
    expect(audits[0].why).toBe('file-missing')
  })

  it('CSP ausente o distinta en index.html: mismatch', async () => {
    for (const csp of [undefined, 'default-src *', `${CSP}; script-src 'unsafe-inline'`]) {
      const { w, audits } = watchOf(
        publish({ tamper: (s) => void s.headers.set('index.html', csp === undefined ? {} : { 'content-security-policy': csp }) })
      )
      expect(await w.check(), String(csp)).toBe('mismatch')
      expect(audits[0].why).toBe('csp')
    }
  })

  it('sin manifiesto o sin firma publicados: mismatch', async () => {
    const a = watchOf(publish({ tamper: (s) => void s.files.delete('site-manifest.json') }))
    expect(await a.w.check()).toBe('mismatch')
    expect(a.audits[0].why).toBe('no-manifest')
    const b = watchOf(publish({ tamper: (s) => void s.files.delete('site-manifest.sig') }))
    expect(await b.w.check()).toBe('mismatch')
    expect(b.audits[0].why).toBe('no-signature')
  })

  it('manifiesto con otra clave nombrada, retroceso de seq o forma rara: mismatch', async () => {
    const k = watchOf(publish({ keyId: 'otra-clave' }))
    expect(await k.w.check()).toBe('mismatch')
    expect(k.audits[0].why).toBe('key-id')
    const r = watchOf(publish({ seq: 500 }), { seq: { v: 900 } })
    expect(await r.w.check()).toBe('mismatch')
    expect(r.audits[0].why).toBe('rollback')
    expect(r.seq.v).toBe(900) // un retroceso no baja el mínimo
    // JSON raro pero con firma válida
    const bad = publish()
    const raw = Buffer.from('{"v":2}')
    bad.files.set('site-manifest.json', raw.toString())
    bad.files.set('site-manifest.sig', updateLib.signBytes(raw, KEY.privateKey))
    const s = watchOf(bad)
    expect(await s.w.check()).toBe('mismatch')
    expect(s.audits[0].why).toBe('manifest-shape')
  })

  it('clave vacía: unknown y NO se hace ninguna petición', async () => {
    const log: string[] = []
    const { w, events } = watchOf(publish(), { publicKey: '', log })
    expect(await w.check()).toBe('unknown')
    expect(w.paused()).toBe(false)
    expect(log).toEqual([])
    expect(events).toEqual([])
  })

  it('sin red: unknown (no pausa) y NO cuenta como manipulación', async () => {
    const { w, audits } = watchOf(publish(), { failAll: true })
    expect(await w.check()).toBe('unknown')
    expect(w.paused()).toBe(false)
    expect(audits).toEqual([])
  })

  it('un 500 o una redirección del sitio no es una prueba de nada: unknown', async () => {
    const site = publish()
    const w = new SiteWatch({
      origin: ORIGIN,
      publicKey: PUB,
      keyId: 'lazunox-site-1',
      fetch: async () => ({ status: 500, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }),
      getMinSeq: () => 0,
      setMinSeq: () => undefined
    })
    expect(site.files.size).toBeGreaterThan(0)
    expect(await w.check()).toBe('unknown')
  })

  it('mismatch -> el dueño lo arregla -> ok: se reanuda y queda constancia', async () => {
    const site = publish({ tamper: (s) => s.files.set('sw.js', 'cambiado') })
    const { w, audits, events } = watchOf(site)
    expect(await w.check()).toBe('mismatch')
    const fixed = publish()
    for (const [k, v] of fixed.files) site.files.set(k, v)
    expect(await w.check()).toBe('ok')
    expect(w.paused()).toBe(false)
    expect(audits.map((a) => a.kind)).toEqual(['site-mismatch', 'site-restored'])
    expect(events).toEqual([
      ['mismatch', 'unknown'],
      ['ok', 'mismatch']
    ])
  })

  it('una comprobación en curso se comparte (no se piden dos veces)', async () => {
    const log: string[] = []
    const { w } = watchOf(publish(), { log })
    await Promise.all([w.check(), w.check()])
    expect(log.filter((u) => u.endsWith('site-manifest.json'))).toHaveLength(1)
  })

  it('pide la página en la raíz (sin /index.html) y limita lo que descarga', async () => {
    const log: string[] = []
    const { w } = watchOf(publish(), { log })
    await w.check()
    expect(log).toContain(`${ORIGIN}/`)
    expect(log.some((u) => u.endsWith('/index.html'))).toBe(false)
    expect(log.some((u) => u.includes('app/assets'))).toBe(false) // solo el arranque
  })
})

describe('SiteWatch: calendario', () => {
  it('start comprueba ya y repite cada 6 h con todo en orden; cada 15 min con fallos; stop lo apaga', async () => {
    const site = publish()
    const { w, timers, events } = watchOf(site)
    w.start()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.state()).toBe('ok')
    expect(timers.at(-1)?.ms).toBe(SITE_CHECK_EVERY_MS)
    site.files.set('sw.js', 'cambiado')
    timers.at(-1)!.fn()
    await new Promise((r) => setTimeout(r, 20))
    expect(w.state()).toBe('mismatch')
    expect(timers.at(-1)?.ms).toBe(SITE_RETRY_MS)
    w.stop()
    expect(w.state()).toBe('unknown')
    expect(timers.at(-1)?.dead).toBe(true)
    expect(events.at(-1)).toEqual(['unknown', 'mismatch'])
  })

  it('con la clave vacía solo vuelve a mirar cada 6 h (no hay nada que reintentar)', async () => {
    const { w, timers } = watchOf(publish(), { publicKey: '' })
    w.start()
    await new Promise((r) => setTimeout(r, 20))
    expect(timers.at(-1)?.ms).toBe(SITE_CHECK_EVERY_MS)
    w.stop()
  })
})

describe('de punta a punta: scripts/site-release.mjs -> SiteWatch', () => {
  let root: string
  let keyFile: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'site-rel-'))
    mkdirSync(join(root, 'src', 'shared'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }))
    const keys = generateKeyPairSync('ed25519')
    keyFile = join(mkdtempSync(join(tmpdir(), 'site-key-')), 'site.pem')
    writeFileSync(keyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }))
    chmodSync(keyFile, 0o600)
    writeBrand(updateLib.spkiBase64(keys.publicKey))
    buildFakeSite('AAAA1111')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function writeBrand(pub: string): void {
    writeFileSync(
      join(root, 'src', 'shared', 'brand.ts'),
      `export const SITE_PUBLIC_KEY = '${pub}' as string\nexport const SITE_KEY_ID = 'lazunox-site-1' as string\n`
    )
  }
  function buildFakeSite(hash: string): void {
    const site = join(root, 'pwa', 'dist-site')
    rmSync(site, { recursive: true, force: true })
    mkdirSync(join(site, 'assets'), { recursive: true })
    mkdirSync(join(site, 'app', 'assets'), { recursive: true })
    writeFileSync(join(site, 'index.html'), `<html><head><script type="module" src="./assets/index-${hash}.js"></script></head></html>`)
    writeFileSync(join(site, 'sw.js'), `const BUILD = '${sha(hash).slice(0, 12)}'`)
    writeFileSync(join(site, 'manifest.webmanifest'), '{}')
    writeFileSync(join(site, '_headers'), '/*\n')
    writeFileSync(join(site, 'assets', `index-${hash}.js`), `1 ${hash}`)
    writeFileSync(join(site, 'app', 'assets', `main-${hash.toLowerCase()}.js`), `app ${hash}`)
  }
  const serve = (): Site => {
    const site = join(root, 'pwa', 'dist-site')
    const files = new Map<string, string>()
    const walkDir = (d: string, rel = ''): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walkDir(join(d, e.name), `${rel}${e.name}/`)
        else if (e.name !== '_headers') files.set(`${rel}${e.name}`, readFileSync(join(d, e.name), 'utf8'))
      }
    }
    walkDir(site)
    return { files, headers: new Map([['index.html', { 'content-security-policy': CSP }]]) }
  }

  it('lo que firma el script lo acepta el cliente real y el manifiesto cumple la forma estricta', async () => {
    const r = release({ root, keyFile, now: () => new Date('2026-10-04T12:00:00Z') })
    expect(r.startup).toEqual(['index.html', 'sw.js', 'manifest.webmanifest', 'assets/index-AAAA1111.js'])
    const man = parseSiteManifest(readFileSync(join(root, 'pwa', 'dist-site', 'site-manifest.json'), 'utf8'))
    expect(man).not.toBeNull()
    expect(man!.files.some((f) => f.p === '_headers' || f.p.startsWith('site-manifest'))).toBe(false)
    const brand = readFileSync(join(root, 'src', 'shared', 'brand.ts'), 'utf8')
    const pub = /SITE_PUBLIC_KEY = '([^']*)'/.exec(brand)![1]
    const { w } = watchOf(serve(), { publicKey: pub })
    expect(await w.check()).toBe('ok')
    // y si alguien cambia un byte del sitio publicado, el cliente lo detecta
    const tampered = serve()
    tampered.files.set('assets/index-AAAA1111.js', 'otro')
    expect(await watchOf(tampered, { publicKey: pub }).w.check()).toBe('mismatch')
  })

  it('no firma si la clave privada no es la de brand.ts', () => {
    writeBrand(updateLib.spkiBase64(generateKeyPairSync('ed25519').publicKey))
    expect(() => release({ root, keyFile })).toThrow(/NO corresponde/)
  })

  it('con SITE_PUBLIC_KEY vacía firma igual pero avisa', () => {
    writeBrand('')
    expect(release({ root, keyFile }).keyWarning).toMatch(/SITE_PUBLIC_KEY está vacía/)
  })

  it('rechaza una clave privada dentro del repositorio o con permisos abiertos', () => {
    const inside = join(root, 'site.pem')
    writeFileSync(inside, readFileSync(keyFile))
    chmodSync(inside, 0o600)
    expect(() => release({ root, keyFile: inside })).toThrow(/DENTRO del repositorio/)
    chmodSync(keyFile, 0o644)
    expect(() => release({ root, keyFile })).toThrow(/Permisos/)
  })

  it('sin pwa/dist-site no hace nada', () => {
    rmSync(join(root, 'pwa'), { recursive: true, force: true })
    expect(() => release({ root, keyFile })).toThrow(/Falta pwa\/dist-site/)
  })

  it('archiva las versiones: la segunda publicación conserva los app/assets de la primera (hasta 10)', () => {
    release({ root, keyFile, now: () => new Date('2026-10-04T12:00:00Z') })
    buildFakeSite('CCCC3333')
    release({ root, keyFile, now: () => new Date('2026-10-05T12:00:00Z') })
    const site = join(root, 'pwa', 'dist-site', 'app', 'assets')
    expect(readFileSync(join(site, 'main-cccc3333.js'), 'utf8')).toBe('app CCCC3333')
    expect(readFileSync(join(site, 'main-aaaa1111.js'), 'utf8')).toBe('app AAAA1111')
    // 12 publicaciones más: solo quedan las 10 últimas
    for (let i = 0; i < 12; i++) {
      const h = `D${String(i).padStart(3, '0')}${i}${i}${i}`.slice(0, 8)
      buildFakeSite(h)
      release({ root, keyFile, now: () => new Date(Date.UTC(2026, 10, 1 + i)) })
    }
    const names = readdirSync(join(root, 'site-archive')).sort()
    expect(names).toHaveLength(10)
    expect(existsSync(join(site, 'main-aaaa1111.js'))).toBe(false)
  })
})
