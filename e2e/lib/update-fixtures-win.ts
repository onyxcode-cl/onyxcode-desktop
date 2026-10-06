// Fixtures del actualizador de Windows: una carpeta «win-unpacked» de juguete, empaquetada con scripts/publish-update.mjs
// (`--platform win32-x64`, solo manifiesto) en un directorio temporal con una marca falsa y una clave Ed25519 EFÍMERA, y firmada
// aquí con esa clave. No toca brand.ts ni la clave real, no hace red y NUNCA ejecuta nada del juguete. Corre en cualquier sistema
// (el ZIP se arma en JS puro); solo `fake.exe` (copia de ping.exe, para el modo de prueba de swap.ps1) exige Windows.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32 } from 'node:zlib'
import { manifestBytes, signBytes } from '../../scripts/update-lib.mjs'
import { APP_ID, UPDATE_KEY_ID } from '../../src/shared/brand'
import { newKeys, FIXTURE_REPO, FIXTURE_VERSION, type Keys } from './update-fixtures'

export { FIXTURE_REPO, FIXTURE_VERSION, newKeys }
export type { Keys }

export interface WinFixtureOptions {
  version?: string
  /** Firma con otra clave (firma inválida). */
  badSignature?: boolean
  /** El manifiesto declara el hash de otro contenido. */
  wrongHash?: boolean
  /** ZIP con una entrada `../evil` (se declara y firma bien). */
  traversalZip?: boolean
  /** Manifiesto de otra versión (repetición), firmado correctamente; el ZIP y su asar son los de `version`. */
  manifestVersion?: string
  /** El app.asar del ZIP lleva esta versión, distinta de la que firma el manifiesto (downgrade encubierto). */
  asarVersion?: string
  /** Relleno (bytes aleatorios) para que la descarga dure. */
  padding?: number
}

export interface WinFixture {
  version: string
  tag: string
  zipName: string
  manifestName: string
  sigName: string
  zip: Buffer
  manifest: Buffer
  sig: string
  dir: string
  /** Ruta del servidor local donde van los archivos de esta versión. */
  base: string
  dispose(): void
}

/** app.asar mínimo: solo la cabecera con package.json en la raíz (lo único que lee el cliente). */
export function makeAsar(version: string, name = 'lazunox'): Buffer {
  const pkg = Buffer.from(JSON.stringify({ name, version }))
  const json = Buffer.from(JSON.stringify({ files: { 'package.json': { size: pkg.length, offset: '0' } } }))
  const padded = Math.ceil(json.length / 4) * 4
  const head = Buffer.alloc(16 + padded)
  head.writeUInt32LE(4, 0)
  head.writeUInt32LE(8 + padded, 4)
  head.writeUInt32LE(4 + padded, 8)
  head.writeUInt32LE(json.length, 12)
  json.copy(head, 16)
  return Buffer.concat([head, pkg])
}

const PING = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'ping.exe')

function toyApp(dir: string, contentVersion: string, padding: number): string {
  const app = join(dir, 'win-unpacked')
  mkdirSync(join(app, 'resources', 'opencode'), { recursive: true })
  mkdirSync(join(app, 'locales'), { recursive: true })
  writeFileSync(join(app, 'Lazunox.exe'), 'MZ-juguete')
  writeFileSync(join(app, 'resources', 'app.asar'), makeAsar(contentVersion))
  writeFileSync(join(app, 'resources', 'opencode', 'opencode.exe'), 'MZ-opencode')
  writeFileSync(join(app, 'locales', 'es.pak'), 'pak')
  writeFileSync(join(app, 'VERSION.txt'), 'nueva')
  // «Ejecutable» que lanza swap.ps1 en su modo de prueba (LAZUNOX_SWAP_TEST_EXEC=fake.exe): una copia de ping.exe.
  if (existsSync(PING)) copyFileSync(PING, join(app, 'fake.exe'))
  if (padding > 0) {
    const buf = Buffer.alloc(padding)
    for (let i = 0; i < padding; i += 65536) buf.fill(Math.floor(Math.random() * 255), i, Math.min(padding, i + 65536))
    writeFileSync(join(app, 'resources', 'relleno.bin'), buf)
  }
  return app
}

/** ZIP «stored» con entradas vacías (nombres peligrosos que buildWinZip no crearía). */
function storedZip(names: string[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const empty = crc32(Buffer.alloc(0))
  for (const n of names) {
    const nb = Buffer.from(n)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(empty, 14)
    local.writeUInt16LE(nb.length, 26)
    parts.push(local, nb)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt32LE(empty, 16)
    c.writeUInt16LE(nb.length, 28)
    c.writeUInt32LE(offset, 42)
    central.push(c, nb)
    offset += 30 + nb.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cd, end])
}

type Publish = (o: {
  appPath: string
  outDir: string
  manifestOnly: boolean
  platform: string
  root: string
}) => Promise<{ zipPath: string; manifestName: string; sigName: string }>

export async function buildWinFixture(keys: Keys, o: WinFixtureOptions = {}): Promise<WinFixture> {
  const version = o.version ?? FIXTURE_VERSION
  const contentVersion = o.asarVersion ?? version
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-e2e-fixture-win-')))
  // Raíz falsa del repositorio: package.json con la versión del contenido y brand.ts con la clave pública EFÍMERA.
  const root = join(dir, 'root')
  mkdirSync(join(root, 'src', 'shared'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'lazunox', version: contentVersion }))
  writeFileSync(
    join(root, 'src', 'shared', 'brand.ts'),
    `export const AUTHOR_ALIAS = '${APP_ID.split('.')[1]}'\nexport const UPDATE_PUBLIC_KEY = '${keys.publicKey}'\nexport const UPDATE_KEY_ID = '${UPDATE_KEY_ID}'\n`
  )
  const app = toyApp(join(dir, 'src'), contentVersion, o.padding ?? 0)
  const { publish } = (await import(pathToFileURL(join(__dirname, '..', '..', 'scripts', 'publish-update.mjs')).href)) as {
    publish: Publish
  }
  const out = join(dir, 'out')
  const pub = await publish({ appPath: app, outDir: out, manifestOnly: true, platform: 'win32-x64', root })

  const m = JSON.parse(readFileSync(join(out, pub.manifestName), 'utf8')) as {
    version: string
    tag: string
    zip: { name: string; size: number; sha256: string }
  }
  let zip: Buffer = readFileSync(pub.zipPath)
  let zipName = m.zip.name
  if (contentVersion !== version) {
    // El manifiesto firma `version` pero el ZIP (y su asar) son de otra: se renombra el ZIP como lo haría una release real.
    zipName = `Lazunox-${version}-win32-x64.zip`
    m.version = version
    m.tag = `v${version}`
    m.zip.name = zipName
  }
  if (o.traversalZip) {
    zip = storedZip(['Lazunox/', '../evil'])
    m.zip.size = zip.length
    m.zip.sha256 = createHash('sha256').update(zip).digest('hex')
  }
  if (o.manifestVersion) {
    m.version = o.manifestVersion
    m.tag = `v${o.manifestVersion}`
  }
  if (o.wrongHash)
    m.zip.sha256 = createHash('sha256')
      .update(Buffer.concat([zip, Buffer.from('x')]))
      .digest('hex')
  const manifest = manifestBytes(m)
  const signer = o.badSignature ? newKeys().privateKey : keys.privateKey
  return {
    version,
    tag: `v${version}`,
    zipName,
    manifestName: pub.manifestName,
    sigName: pub.sigName,
    zip,
    manifest,
    sig: signBytes(manifest, signer),
    dir,
    base: `/${FIXTURE_REPO}/releases/download/v${version}`,
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
