// Pruebas del constructor de la imagen base de «Tareas en Windows»: `inspect-lib` y `pin-lib` con tars sintéticos creados en memoria
// (sin Docker, sin red, sin disco). También comprueban por lectura el flujo de GitHub y los scripts de shell.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { inspectEntries, inspectTarGz, normalize, readTar, unsafePath } from './wsl-rootfs/inspect-lib.mjs'
import {
  buildOpencodeLinuxAsset,
  buildRootfsPin,
  compareVersions,
  mergePin,
  OPENCODE_LINUX_ASSET,
  parseBuildJson,
  rootfsUrl,
  serializePin
} from './wsl-rootfs/pin-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WSL_CONF = readFileSync(resolve(root, 'resources/wsl/wsl.conf'), 'utf8')
const sha = (b) => createHash('sha256').update(b).digest('hex')

// ---------- constructor de tars ustar en memoria ----------
const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0'
function header({ path, type = '0', mode = 0o644, uid = 0, gid = 0, size = 0, linkname = '', prefix = '' }) {
  const h = Buffer.alloc(512)
  h.write(path, 0, 100, 'utf8')
  h.write(oct(mode, 8), 100)
  h.write(oct(uid, 8), 108)
  h.write(oct(gid, 8), 116)
  h.write(oct(size, 12), 124)
  h.write(oct(0, 12), 136)
  h.write(' '.repeat(8), 148)
  h.write(type, 156)
  h.write(linkname, 157, 100, 'utf8')
  h.write('ustar\0', 257)
  h.write('00', 263)
  h.write(prefix, 345, 155, 'utf8')
  let s = 0
  for (const b of h) s += b
  h.write(oct(s, 7).slice(0, 6) + '\0 ', 148)
  return h
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)])
function tar(items, { end = true } = {}) {
  const parts = []
  for (const it of items) {
    if (it.raw) {
      parts.push(it.raw)
      continue
    }
    const data = it.data === undefined ? Buffer.alloc(0) : Buffer.from(it.data)
    const type = it.type ?? (it.dir ? '5' : '0')
    parts.push(header({ ...it, type, size: type === '0' ? data.length : 0 }))
    if (type === '0' && data.length) parts.push(pad(data))
  }
  if (end) parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

const MARKER = JSON.stringify({ id: 'lazunox-rootfs', version: '2026.10.1', snapshot: '20261001T000000Z', epoch: 1790812800 })
const PASSWD = 'root:x:0:0:root:/root:/bin/bash\nlazunox:x:1000:1000:Lazunox:/home/lazunox:/usr/sbin/nologin\n'
const SHADOW = 'root:*:20000:0:99999:7:::\nlazunox:*:20000:0:99999:7:::\n'
/** Imagen válida mínima; `mut(items)` la estropea de una forma concreta. */
function goodItems() {
  return [
    { path: './', dir: true, mode: 0o755 },
    { path: './etc/', dir: true, mode: 0o755 },
    { path: './etc/wsl.conf', data: WSL_CONF },
    { path: './etc/passwd', data: PASSWD },
    { path: './etc/group', data: 'root:x:0:\nlazunox:x:1000:\n' },
    { path: './etc/shadow', data: SHADOW, mode: 0o640 },
    { path: './etc/lazunox-rootfs.json', data: MARKER },
    { path: './opt/', dir: true, mode: 0o755 },
    { path: './opt/lazunox/', dir: true, mode: 0o755 },
    { path: './usr/local/sbin/lazunox-install', data: '#!/usr/bin/python3\n', mode: 0o755 },
    { path: './usr/bin/python3', data: 'x', mode: 0o755 },
    { path: './usr/bin/rg', data: 'x', mode: 0o755 },
    { path: './usr/bin/git', data: 'x', mode: 0o755 },
    { path: './usr/bin/mount', data: 'x', mode: 0o755 },
    { path: './bin', type: '2', linkname: 'usr/bin' }
  ]
}
const inspectItems = (items, opts = {}) => {
  const { entries, errors } = readTar(tar(items))
  const r = inspectEntries(entries, { wslConf: WSL_CONF, unpackedSize: 1000, ...opts })
  return { ...r, errors: [...errors, ...r.errors] }
}
const has = (r, re) => r.errors.some((e) => re.test(e))

test('inspect: la imagen válida pasa y devuelve la versión', () => {
  const r = inspectItems(goodItems())
  assert.deepEqual(r.errors, [])
  assert.equal(r.info.version, '2026.10.1')
})

test('inspect: también pasa comprimida con gzip', () => {
  const r = inspectTarGz(gzipSync(tar(goodItems())), { wslConf: WSL_CONF, expectedVersion: '2026.10.1' })
  assert.deepEqual(r.errors, [])
  assert.equal(inspectTarGz(gzipSync(tar(goodItems())), { wslConf: WSL_CONF, expectedVersion: '2026.9.1' }).ok, false)
})

test('inspect: wsl.conf distinto, ausente o con un byte de más', () => {
  const edit = (f) => goodItems().map((i) => (i.path === './etc/wsl.conf' ? f(i) : i))
  assert.ok(has(inspectItems(edit((i) => ({ ...i, data: WSL_CONF + '\n' }))), /wsl\.conf no es igual/))
  assert.ok(has(inspectItems(edit((i) => ({ ...i, data: WSL_CONF.replace('false', 'true') }))), /wsl\.conf no es igual/))
  assert.ok(has(inspectItems(goodItems().filter((i) => i.path !== './etc/wsl.conf')), /falta \/etc\/wsl\.conf/))
})

test('inspect: passwd exige lazunox 1000 con nologin y uid 1000 único', () => {
  const withPasswd = (p) => goodItems().map((i) => (i.path === './etc/passwd' ? { ...i, data: p } : i))
  assert.ok(has(inspectItems(withPasswd('root:x:0:0:r:/root:/bin/sh\n')), /passwd no trae lazunox/))
  assert.ok(has(inspectItems(withPasswd(PASSWD.replace('/usr/sbin/nologin', '/bin/bash'))), /passwd no trae lazunox/))
  assert.ok(has(inspectItems(withPasswd(PASSWD + 'otro:x:1000:1000::/home/otro:/bin/sh\n')), /uid 1000/))
})

test('inspect: root debe estar bloqueado', () => {
  const r = inspectItems(goodItems().map((i) => (i.path === './etc/shadow' ? { ...i, data: 'root:$6$abc:1:::::\n' } : i)))
  assert.ok(has(r, /root no está bloqueada/))
})

test('inspect: rechaza setuid y setgid en archivos y carpetas, no en enlaces', () => {
  assert.ok(has(inspectItems([...goodItems(), { path: './usr/bin/su', data: 'x', mode: 0o4755 }]), /setuid\/setgid en «\.\/usr\/bin\/su»/))
  assert.ok(has(inspectItems([...goodItems(), { path: './var/mail/', dir: true, mode: 0o2660 }]), /setuid\/setgid/))
  assert.ok(has(inspectItems([...goodItems(), { path: './usr/bin/x', data: 'x', mode: 0o2755 }]), /setuid\/setgid/))
  assert.deepEqual(inspectItems([...goodItems(), { path: './tmp/', dir: true, mode: 0o1777 }]).errors, [])
})

test('inspect: sin sudo', () => {
  assert.ok(has(inspectItems([...goodItems(), { path: './usr/bin/sudo', data: 'x', mode: 0o755 }]), /usr\/bin\/sudo/))
  assert.ok(has(inspectItems([...goodItems(), { path: './etc/sudoers', data: 'x' }]), /sudoers/))
})

test('inspect: /opt/lazunox vacío, root:root 0755', () => {
  assert.ok(has(inspectItems([...goodItems(), { path: './opt/lazunox/launcher.py', data: 'x' }]), /debe estar vacío/))
  assert.ok(has(inspectItems([...goodItems(), { path: './opt/lazunox/sub/', dir: true }]), /debe estar vacío/))
  assert.ok(has(inspectItems(goodItems().map((i) => (i.path === './opt/lazunox/' ? { ...i, mode: 0o775 } : i))), /root:root 0755/))
  assert.ok(has(inspectItems(goodItems().map((i) => (i.path === './opt/lazunox/' ? { ...i, uid: 1000 } : i))), /root:root 0755/))
  assert.ok(has(inspectItems(goodItems().filter((i) => i.path !== './opt/lazunox/')), /falta la carpeta \/opt\/lazunox/))
})

test('inspect: lazunox-install root 0755', () => {
  const edit = (patch) => goodItems().map((i) => (i.path === './usr/local/sbin/lazunox-install' ? { ...i, ...patch } : i))
  assert.ok(has(inspectItems(edit({ mode: 0o775 })), /lazunox-install debe ser root:root 0755/))
  assert.ok(has(inspectItems(edit({ uid: 1000 })), /lazunox-install debe ser root:root 0755/))
  assert.ok(has(inspectItems(goodItems().filter((i) => !i.path.endsWith('lazunox-install'))), /falta \/usr\/local\/sbin\/lazunox-install/))
})

test('inspect: rutas absolutas, con .. y con barra invertida', () => {
  for (const bad of ['/etc/x', './etc/../../x', 'a\\b', './a//b', './a/./b']) {
    assert.ok(has(inspectItems([...goodItems(), { path: bad, data: 'x' }]), /ruta insegura/), bad)
  }
  assert.ok(has(inspectItems([...goodItems(), { path: './x', type: '1', linkname: '../../etc/passwd' }]), /enlace duro inseguro/))
  // Un symlink absoluto es normal dentro de una raíz (p. ej. /etc/alternatives) y no se rechaza.
  assert.deepEqual(inspectItems([...goodItems(), { path: './etc/mtab', type: '2', linkname: '/proc/self/mounts' }]).errors, [])
})

test('inspect: binarios requeridos y tipos no admitidos', () => {
  for (const b of ['python3', 'rg', 'git', 'mount']) {
    assert.ok(has(inspectItems(goodItems().filter((i) => i.path !== `./usr/bin/${b}`)), new RegExp(`falta el binario ${b}`)), b)
  }
  assert.ok(has(inspectItems([...goodItems(), { path: './dev/sda', type: '6' }]), /tipo de entrada no admitido otro\(6\)/) === false)
  assert.ok(has(inspectItems([...goodItems(), { path: './x', type: 'S' }]), /tipo de entrada no admitido/))
})

test('inspect: tope del tamaño descomprimido', () => {
  assert.ok(has(inspectItems(goodItems(), { unpackedSize: 943_718_401 }), /tamaño descomprimido/))
  assert.deepEqual(inspectItems(goodItems(), { unpackedSize: 943_718_400 }).errors, [])
  const bomb = inspectTarGz(gzipSync(Buffer.alloc(200_000)), { wslConf: WSL_CONF, unpackedMax: 100_000 })
  assert.equal(bomb.ok, false)
  assert.match(bomb.errors[0], /pasa de 100000/)
})

test('inspect: marcador /etc/lazunox-rootfs.json obligatorio y válido', () => {
  assert.ok(has(inspectItems(goodItems().filter((i) => i.path !== './etc/lazunox-rootfs.json')), /falta \/etc\/lazunox-rootfs\.json/))
  assert.ok(has(inspectItems(goodItems().map((i) => (i.path.endsWith('rootfs.json') ? { ...i, data: '{no' } : i))), /no es JSON/))
  assert.ok(
    has(
      inspectItems(goodItems().map((i) => (i.path.endsWith('rootfs.json') ? { ...i, data: '{"id":"x","version":"1"}' } : i))),
      /id y versión/
    )
  )
})

test('lector tar: truncado, suma de control, ceros sueltos y datos tras el cierre', () => {
  const good = tar(goodItems())
  assert.deepEqual(readTar(good).errors, [])
  assert.match(readTar(tar(goodItems(), { end: false })).errors[0], /no termina con los dos bloques/)
  assert.match(readTar(good.subarray(0, good.length - 1500)).errors[0], /tar ilegible/)
  const cut = tar([{ path: './a', data: 'x'.repeat(2000) }], { end: false })
  assert.match(readTar(cut.subarray(0, 700)).errors[0], /cuerpo truncado/)
  const corrupt = Buffer.from(good)
  corrupt[10] ^= 0xff
  assert.match(readTar(corrupt).errors[0], /suma de control/)
  assert.match(readTar(Buffer.concat([tar([{ path: './a', data: 'x' }]), Buffer.from('basura')])).errors[0], /datos tras el cierre/)
  assert.match(
    readTar(Buffer.concat([tar([{ path: './a', data: 'x' }], { end: false }), Buffer.alloc(512)])).errors[0],
    /un solo bloque|dos bloques/
  )
  assert.equal(inspectTarGz(gzipSync(good.subarray(0, 900)), { wslConf: WSL_CONF }).ok, false)
  assert.equal(inspectTarGz(Buffer.from('no es gzip'), { wslConf: WSL_CONF }).ok, false)
})

test('lector tar: prefijo ustar, GNU L, pax y base-256 se leen bien', () => {
  const long = './' + 'd/'.repeat(80) + 'f.txt'
  const gnu = tar([
    { raw: header({ path: '././@LongLink', type: 'L', size: long.length + 1 }) },
    { raw: pad(Buffer.from(long + '\0')) },
    { path: 'corto', data: 'hola' }
  ])
  assert.equal(readTar(gnu).entries[0].path, long)
  const rec = (k, v) => {
    const body = ` ${k}=${v}\n`
    let len = body.length + 1
    while (String(len).length + body.length !== len) len = String(len).length + body.length
    return `${len}${body}`
  }
  const px = Buffer.from(rec('path', long) + rec('uid', '4242'))
  const pax = tar([{ raw: header({ path: 'PaxHeader', type: 'x', size: px.length }) }, { raw: pad(px) }, { path: 'corto', data: 'x' }])
  const e = readTar(pax).entries[0]
  assert.equal(e.path, long)
  assert.equal(e.uid, 4242)
  const pre = readTar(tar([{ path: 'f.txt', prefix: 'a/b', data: 'x' }])).entries[0]
  assert.equal(pre.path, 'a/b/f.txt')
  // Tamaño en base-256 (campo con el bit alto).
  const h = header({ path: 'big', size: 0 })
  h.fill(0, 124, 136)
  h[124] = 0x80
  h.writeUIntBE(3, 130, 6)
  let s = 0
  for (let i = 0; i < 512; i++) s += i >= 148 && i < 156 ? 32 : h[i]
  h.write(oct(s, 7).slice(0, 6) + '\0 ', 148)
  const r = readTar(Buffer.concat([h, pad(Buffer.from('abc')), Buffer.alloc(1024)]))
  assert.deepEqual(r.errors, [])
  assert.equal(r.entries[0].size, 3)
})

test('lector tar: un pax con uid manipulado se ve en las comprobaciones de dueño', () => {
  const px = Buffer.from('12 uid=1000\n')
  const t = tar([
    ...goodItems().filter((i) => !i.path.endsWith('lazunox-install')),
    { raw: header({ path: 'PaxHeader', type: 'x', size: px.length }) },
    { raw: pad(px) },
    { path: './usr/local/sbin/lazunox-install', data: 'x', mode: 0o755 }
  ])
  const { entries } = readTar(t)
  const r = inspectEntries(entries, { wslConf: WSL_CONF, unpackedSize: 1 })
  assert.ok(has(r, /lazunox-install debe ser root:root 0755/))
})

test('normalize y unsafePath', () => {
  assert.equal(normalize('./etc/passwd'), 'etc/passwd')
  assert.equal(normalize('./opt/lazunox/'), 'opt/lazunox')
  assert.equal(normalize('./'), '')
  assert.equal(unsafePath('./'), null)
  assert.equal(unsafePath('./usr/bin/x'), null)
  assert.ok(unsafePath('..'))
  assert.ok(unsafePath('a\0b'))
  assert.ok(unsafePath(''))
})

// ---------- pin-lib ----------
const image = gzipSync(tar(goodItems()), { level: 9 })
const unpacked = tar(goodItems()).length
const build = (over = {}) => ({
  id: 'lazunox-rootfs',
  version: '2026.10.1',
  arch: 'x64',
  suite: 'trixie',
  snapshot: '20261001T000000Z',
  epoch: 1790812800,
  builtAt: '2026-10-01',
  file: 'lazunox-rootfs-2026.10.1-x64.tar.gz',
  sha256: sha(image),
  size: image.length,
  unpackedSize: unpacked,
  checked: true,
  ...over
})
const dl =
  (buf, seen = []) =>
  async (url) => {
    seen.push(url)
    return buf
  }

test('pin-lib: la imagen se fija con dos construcciones iguales y devuelve la forma exacta', async () => {
  const seen = []
  const p = await buildRootfsPin({ version: '2026.10.1', builds: [build(), build()], download: dl(image, seen), wslConf: WSL_CONF })
  assert.deepEqual(seen, [rootfsUrl('2026.10.1')])
  assert.deepEqual(p, {
    version: '2026.10.1',
    minVersion: '2026.10.1',
    builtAt: '2026-10-01',
    url: 'https://github.com/onyxcode-cl/lazunox-wsl/releases/download/rootfs-2026.10.1/lazunox-rootfs-2026.10.1-x64.tar.gz',
    sha256: sha(image),
    size: image.length,
    unpackedMax: 943718400
  })
})

test('pin-lib: rechaza construcciones que difieren, una sola, otra versión o minVersion mayor', async () => {
  const run = (o) => buildRootfsPin({ version: '2026.10.1', download: dl(image), wslConf: WSL_CONF, builds: [build(), build()], ...o })
  await assert.rejects(run({ builds: [build(), build({ sha256: 'a'.repeat(64) })] }), /difieren en sha256/)
  await assert.rejects(run({ builds: [build(), build({ size: 5 })] }), /difieren en size/)
  await assert.rejects(run({ builds: [build()] }), /DOS construcciones/)
  await assert.rejects(run({ builds: [build({ version: '2026.9.1' }), build({ version: '2026.9.1' })] }), /no de 2026\.10\.1/)
  await assert.rejects(run({ minVersion: '2026.11.1' }), /minVersion/)
  await assert.rejects(run({ version: '1.2' }), /versión inválida/)
})

test('pin-lib: el asset publicado debe coincidir en tamaño, sha e inspect', async () => {
  const run = (buf, over) =>
    buildRootfsPin({ version: '2026.10.1', builds: [build(over), build(over)], download: dl(buf), wslConf: WSL_CONF })
  await assert.rejects(run(Buffer.concat([image, Buffer.from('x')])), /tamaño del asset/)
  const other = Buffer.from(image)
  other[other.length - 20] ^= 1
  await assert.rejects(run(other), /SHA-256 del asset/)
  // Imagen con setuid: sha y tamaño cuadran pero inspect la rechaza.
  const bad = gzipSync(tar([...goodItems(), { path: './usr/bin/su', data: 'x', mode: 0o4755 }]))
  await assert.rejects(run(bad, { sha256: sha(bad), size: bad.length }), /no pasa inspect[\s\S]*setuid/)
  // Versión del marcador distinta de la pedida.
  const v = gzipSync(
    tar(goodItems().map((i) => (i.path.endsWith('rootfs.json') ? { ...i, data: MARKER.replace('2026.10.1', '2026.9.1') } : i)))
  )
  await assert.rejects(run(v, { sha256: sha(v), size: v.length }), /se esperaba 2026\.10\.1/)
  // unpackedSize declarado distinto del real.
  await assert.rejects(run(image, { unpackedSize: unpacked + 1 }), /descomprimido real/)
})

test('pin-lib: parseBuildJson valida la forma', () => {
  assert.equal(parseBuildJson(JSON.stringify(build())).sha256, sha(image))
  for (const over of [
    { id: 'x' },
    { arch: 'arm64' },
    { sha256: 'xyz' },
    { size: 0 },
    { builtAt: 'ayer' },
    { snapshot: '2026' },
    { epoch: -1 },
    { unpackedSize: 9e9 }
  ]) {
    assert.throws(() => parseBuildJson(build(over)), /rootfs-build\.json/, JSON.stringify(over))
  }
  assert.throws(() => parseBuildJson(null))
})

test('pin-lib: compareVersions numérica', () => {
  assert.equal(compareVersions('2026.10.1', '2026.9.30'), 1)
  assert.equal(compareVersions('2026.9.1', '2026.10.1'), -1)
  assert.equal(compareVersions('2026.10.1', '2026.10.1'), 0)
})

const OC = Buffer.from('tgz de opencode de prueba')
const release = (over = {}) => ({
  tag_name: 'v1.18.33',
  assets: [
    {
      name: OPENCODE_LINUX_ASSET,
      size: OC.length,
      digest: `sha256:${sha(OC)}`,
      browser_download_url: `https://github.com/anomalyco/opencode/releases/download/v1.18.33/${OPENCODE_LINUX_ASSET}`,
      ...over
    }
  ]
})
const ocIo = (rel, buf = OC) => ({ getJson: async () => rel, download: async () => buf })

test('pin-lib: asset linux-x64 de opencode contra la API', async () => {
  const a = await buildOpencodeLinuxAsset({ version: '1.18.33', io: ocIo(release()) })
  assert.deepEqual(a, {
    url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
    sha256: sha(OC),
    size: OC.length
  })
  const run = (rel, buf) => buildOpencodeLinuxAsset({ version: '1.18.33', io: ocIo(rel, buf) })
  await assert.rejects(run({ ...release(), tag_name: 'v9' }), /no es la pedida/)
  await assert.rejects(run({ ...release(), assets: [] }), /falta el asset/)
  await assert.rejects(run(release({ browser_download_url: 'https://evil.example/x.tar.gz' })), /URL inesperada/)
  await assert.rejects(run(release({ digest: null })), /no da el digest/)
  await assert.rejects(run(release({ size: 3 })), /tamaño/)
  await assert.rejects(run(release(), Buffer.from('tgz de opencode de pruebX')), /SHA-256/)
  await assert.rejects(buildOpencodeLinuxAsset({ version: 'latest', io: ocIo(release()) }), /versión de opencode inválida/)
})

test('pin-lib: mergePin añade las dos claves sin tocar lo demás ni mutar la entrada', async () => {
  const existing = JSON.parse(readFileSync(resolve(root, 'resources/opencode-bin/pin.json'), 'utf8'))
  const before = JSON.stringify(existing)
  const rootfs = await buildRootfsPin({ version: '2026.10.1', builds: [build(), build()], download: dl(image), wslConf: WSL_CONF })
  const opencodeLinux = {
    url: `https://github.com/anomalyco/opencode/releases/download/v${existing.version}/opencode-linux-x64.tar.gz`,
    sha256: sha(OC),
    size: OC.length
  }
  const merged = mergePin(existing, { rootfs, opencodeLinux })
  assert.equal(JSON.stringify(existing), before)
  assert.equal(merged.version, existing.version)
  assert.deepEqual(merged.assets['darwin-arm64'], existing.assets['darwin-arm64'])
  assert.deepEqual(merged.assets['win32-x64'], existing.assets['win32-x64'])
  assert.deepEqual(merged.assets['linux-x64'], opencodeLinux)
  assert.deepEqual(merged['wsl-rootfs'], rootfs)
  assert.ok(serializePin(merged).endsWith('}\n'))
  // Idempotente: aplicar dos veces da lo mismo.
  assert.equal(serializePin(mergePin(merged, { rootfs, opencodeLinux })), serializePin(merged))
  assert.throws(
    () =>
      mergePin(existing, { rootfs, opencodeLinux: { ...opencodeLinux, url: opencodeLinux.url.replace(`v${existing.version}`, 'v0.0.1') } }),
    /versión/
  )
  assert.throws(() => mergePin({}, { rootfs, opencodeLinux }), /inválido/)
})

test('el pin.json actual conserva los assets de siempre (esta tanda no lo toca; si trae `wsl-rootfs`, es válido)', () => {
  const pin = JSON.parse(readFileSync(resolve(root, 'resources/opencode-bin/pin.json'), 'utf8'))
  assert.ok(pin.assets['darwin-arm64'] && pin.assets['win32-x64'])
  if ('wsl-rootfs' in pin) assert.match(pin['wsl-rootfs'].sha256, /^[0-9a-f]{64}$/)
})

// ---------- flujo de GitHub y scripts ----------
const wf = readFileSync(resolve(root, '.github/workflows/wsl-rootfs.yml'), 'utf8')
const code = (t) =>
  t
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')

test('wsl-rootfs.yml: manual, solo lectura, acciones por SHA y sin secretos ni publicación', () => {
  const c = code(wf)
  assert.match(c, /^on:\s*\n\s+workflow_dispatch:/m)
  assert.ok(!/^\s+(push|pull_request|schedule):/m.test(c), 'solo workflow_dispatch')
  assert.match(c, /^permissions:\s*\n\s+contents: read/m)
  assert.ok(!/write/.test(c.replace(/cancel-in-progress/g, '')), 'sin permisos de escritura')
  assert.ok(!/secrets\./.test(c))
  assert.ok(!/gh release|--latest|--draft/.test(c), 'no publica nada')
  const uses = [...c.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
  assert.ok(uses.some((u) => u.startsWith('actions/upload-artifact@')))
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u)
  // Las entradas del usuario nunca se interpolan dentro de `run:` (van por `env:`).
  for (const run of c.split(/\n\s+run:/).slice(1))
    assert.ok(!/\$\{\{\s*inputs\./.test(run.split(/\n\s+- /)[0].split(/\n\s+env:/)[0]), 'inputs fuera de run')
  const y = createRequire(import.meta.url)
  try {
    const parsed = y('js-yaml').load(wf)
    assert.deepEqual(Object.keys(parsed.jobs), ['build'])
  } catch (e) {
    if (e?.code !== 'MODULE_NOT_FOUND') throw e
  }
})

test('los scripts de shell piden --inside, no ejecutan nada por sí solos y fijan SOURCE_DATE_EPOCH', () => {
  const b = readFileSync(resolve(root, 'scripts/build-wsl-rootfs.sh'), 'utf8')
  const c = readFileSync(resolve(root, 'scripts/wsl-rootfs/customize.sh'), 'utf8')
  assert.match(b, /^#!\/bin\/bash/)
  assert.match(b, /set -euo pipefail/)
  assert.match(b, /Falta --inside/)
  assert.match(b, /gzip -n -9/)
  assert.match(b, /snapshot\.debian\.org\/archive\/debian\/\$SNAPSHOT\//)
  assert.match(b, /snapshot\.debian\.org\/archive\/debian-security\/\$SNAPSHOT\//)
  assert.match(b, /--variant=minbase/)
  assert.match(c, /set -euo pipefail/)
  assert.match(c, /SOURCE_DATE_EPOCH/)
  assert.match(c, /chmod ug-s/)
  assert.match(c, /lazunox:x:1000:1000:Lazunox:\/home\/lazunox:\/usr\/sbin\/nologin/)
  // Nada no determinista en el gancho.
  assert.ok(!/\$\(date(?! -u -d)|\$RANDOM|uuidgen|useradd/.test(c.replace(/^\s*#.*$/gm, '')))
  const pk = readFileSync(resolve(root, 'scripts/wsl-rootfs/packages.txt'), 'utf8')
  const pkgs = pk.split('\n').filter((l) => l && !l.startsWith('#'))
  for (const need of ['python3', 'git', 'ripgrep', 'mount', 'ca-certificates']) assert.ok(pkgs.includes(need), need)
  for (const banned of ['sudo', 'curl', 'systemd', 'locales', 'iproute2']) assert.ok(!pkgs.includes(banned), banned)
})
