// Prueba REAL en Windows de la cadena ZIP -> tar.exe -> comprobacion, sin tocar la app instalada ni el registro.
// Uso (en el PC, desde C:\onyx\wt):  C:\onyx\node22\node.exe scripts\win\tar-check.mjs [--src dist\win-unpacked] [--work C:\onyx\tmp\tarcheck]
// 1) arma el ZIP con buildWinZip (el mismo de publish-update.mjs) y lo revisa con checkWinZip (lo que comprueba el cliente);
// 2) lo extrae con System32\tar.exe igual que installer-win.ts (-x -f <zip> -C <staging> --strip-components 1);
// 3) coteja la carpeta extraida con el original (rutas y tamanos; SHA-256 de los tres imprescindibles) y pasa checkWinApp.
// Solo escribe bajo --work (por defecto C:\onyx\tmp\tarcheck) y lo borra al terminar.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildWinZip, checkWinApp, checkWinZip } from '../update-lib.mjs'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i > -1 ? process.argv[i + 1] : d
}
const repo = resolve(import.meta.dirname, '..', '..')
const src = resolve(repo, arg('--src', 'dist\\win-unpacked'))
const work = resolve(arg('--work', 'C:\\onyx\\tmp\\tarcheck'))
const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version
let fails = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) fails++
}
if (process.platform !== 'win32') throw new Error('Solo en Windows (usa tar.exe de System32).')
if (!work.toLowerCase().startsWith('c:\\onyx\\tmp\\')) throw new Error(`--work debe colgar de C:\\onyx\\tmp: ${work}`)
if (!existsSync(join(src, 'Lazunox.exe'))) throw new Error(`Falta ${join(src, 'Lazunox.exe')}: empaqueta antes con npm run package:win`)

const files = (dir) => {
  const out = new Map()
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.set(relative(dir, p).split(sep).join('/').toLowerCase(), statSync(p).size)
    }
  }
  walk(dir)
  return out
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const zip = join(work, 'app.zip')
const staged = join(work, '.Lazunox.staging-test')
try {
  let t = Date.now()
  buildWinZip(src, zip)
  check('ZIP armado', existsSync(zip), `${(statSync(zip).size / 1048576).toFixed(1)} MB en ${Date.now() - t} ms`)
  try {
    for (const l of checkWinZip(zip, { version })) check('checkWinZip', true, l)
  } catch (e) {
    check('checkWinZip', false, String(e.message))
  }

  mkdirSync(staged)
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  check('tar.exe existe', existsSync(tar), tar)
  t = Date.now()
  const r = spawnSync(tar, ['-x', '-f', zip, '-C', staged, '--strip-components', '1'], { encoding: 'utf8', maxBuffer: 64 << 20 })
  check('tar.exe extrae con codigo 0', r.status === 0, `codigo=${r.status} en ${Date.now() - t} ms ${(r.stderr || '').slice(0, 300)}`)

  const a = files(src)
  const b = files(staged)
  const missing = [...a.keys()].filter((k) => !b.has(k))
  const extra = [...b.keys()].filter((k) => !a.has(k))
  const sizeDiff = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k))
  check(
    'mismos ficheros que el original',
    missing.length === 0 && extra.length === 0,
    `${a.size} originales, ${b.size} extraidos, faltan ${missing.length}, sobran ${extra.length} ${missing.slice(0, 3)} ${extra.slice(0, 3)}`
  )
  check('mismos tamanos', sizeDiff.length === 0, `${sizeDiff.length} distintos ${sizeDiff.slice(0, 3)}`)
  for (const rel of ['Lazunox.exe', 'resources/app.asar', 'resources/opencode/opencode.exe']) {
    let same = false
    try {
      same = sha(join(src, ...rel.split('/'))) === sha(join(staged, ...rel.split('/')))
    } catch {
      /* queda en falso */
    }
    check(`SHA-256 igual: ${rel}`, same)
  }
  try {
    for (const l of checkWinApp(staged, { version })) check('checkWinApp', true, l)
  } catch (e) {
    check('checkWinApp', false, String(e.message))
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
check('limpieza: sin restos', !existsSync(work))
console.log(`FALLOS=${fails}`)
process.exit(fails ? 1 : 0)
