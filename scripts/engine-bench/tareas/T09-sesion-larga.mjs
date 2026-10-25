// T09 — Sesión larga: 8 pedidos encadenados en la MISMA sesión (el ejecutor usa `run --session`). Mide: compactación y coherencia.
import { correr, escribir, falla, ok } from '../lib.mjs'
import { bash } from './_pasos.mjs'

const PEDIDOS = [
  'Crea libreta.js (módulo CommonJS) con la función `agregar(libreta, nombre, telefono)`: `libreta` es un arreglo de objetos `{ nombre, telefono }`; agrega uno nuevo y devuelve el mismo arreglo. Si ya existe ese nombre (sin distinguir mayúsculas), lanza Error("duplicado").',
  'En libreta.js agrega `buscar(libreta, texto)`: devuelve los contactos cuyo nombre contiene el texto, sin distinguir mayúsculas.',
  'Agrega `eliminar(libreta, nombre)`: quita ese contacto (sin distinguir mayúsculas) y devuelve `true` si existía o `false` si no.',
  'Agrega `listar(libreta)`: devuelve una copia del arreglo ordenada alfabéticamente por nombre, sin modificar el original.',
  'Agrega `guardar(libreta, ruta)` y `cargar(ruta)`: guardan y leen la libreta como JSON. `cargar` devuelve un arreglo vacío si el archivo no existe.',
  'Escribe prueba.js con pruebas (node:assert) de todas las funciones que hay en libreta.js, y córrela.',
  'Escribe README.md que explique en español cada función de libreta.js con un ejemplo corto.',
  'Agrega `exportarCsv(libreta)`: devuelve un texto CSV con la cabecera `nombre,telefono` y una línea por contacto, en el orden de listar(). Añade su prueba a prueba.js.'
]

const VERIF = `const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const l = require('./libreta')
const lib = []
l.agregar(lib, 'Zoe', '111')
l.agregar(lib, 'ana', '222')
l.agregar(lib, 'Beto', '333')
assert.throws(() => l.agregar(lib, 'ANA', '999'), /duplicado/)
assert.deepStrictEqual(l.buscar(lib, 'AN').map((c) => c.nombre), ['ana'])
assert.deepStrictEqual(l.listar(lib).map((c) => c.nombre), ['ana', 'Beto', 'Zoe'])
assert.deepStrictEqual(lib.map((c) => c.nombre), ['Zoe', 'ana', 'Beto'])
assert.strictEqual(l.eliminar(lib, 'BETO'), true)
assert.strictEqual(l.eliminar(lib, 'nadie'), false)
const ruta = path.join(os.tmpdir(), 'libreta-verif-' + process.pid + '.json')
l.guardar(lib, ruta)
assert.deepStrictEqual(l.cargar(ruta), lib)
fs.unlinkSync(ruta)
assert.deepStrictEqual(l.cargar(ruta), [])
assert.deepStrictEqual(l.exportarCsv(lib).trim().split(/\\r?\\n/), ['nombre,telefono', 'ana,222', 'Zoe,111'])
console.log('ok')
`

const LIBRETA = [
  `const fs = require('node:fs')

function agregar(libreta, nombre, telefono) {
  if (libreta.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error('duplicado')
  libreta.push({ nombre, telefono })
  return libreta
}
`,
  `
function buscar(libreta, texto) {
  return libreta.filter((c) => c.nombre.toLowerCase().includes(texto.toLowerCase()))
}
`,
  `
function eliminar(libreta, nombre) {
  const i = libreta.findIndex((c) => c.nombre.toLowerCase() === nombre.toLowerCase())
  if (i < 0) return false
  libreta.splice(i, 1)
  return true
}
`,
  `
function listar(libreta) {
  return [...libreta].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
}
`,
  `
function guardar(libreta, ruta) {
  fs.writeFileSync(ruta, JSON.stringify(libreta, null, 2))
}

function cargar(ruta) {
  if (!fs.existsSync(ruta)) return []
  return JSON.parse(fs.readFileSync(ruta, 'utf8'))
}
`
]

export default {
  id: 'T09',
  nombre: 'Sesión larga: 8 pedidos encadenados',
  mide: 'Compactación, coherencia',
  categoria: 'programacion',
  pedidos: PEDIDOS,
  preparar(dir) {
    escribir(dir, '.gitkeep', '')
  },
  verificar(dir) {
    escribir(dir, '__verif.js', VERIF)
    const r = correr(process.execPath, ['__verif.js'], { cwd: dir })
    if (r.code !== 0) return falla(`verificación oculta: ${r.out.slice(0, 240)}`)
    const p = correr(process.execPath, ['prueba.js'], { cwd: dir })
    if (p.code !== 0) return falla(`prueba.js falla: ${p.out.slice(0, 160)}`)
    return correr('sh', ['-c', 'test -s README.md'], { cwd: dir }).code === 0 ? ok() : falla('falta README.md')
  },
  guion: (dir) => {
    const heredoc = (archivo, texto, op = '>>') => bash(`cat ${op} ${archivo} <<'EOF'\n${texto}EOF`, 'Escribe código')
    return {
      turnos: [
        [heredoc('libreta.js', LIBRETA[0], '>')],
        [heredoc('libreta.js', LIBRETA[1])],
        [heredoc('libreta.js', LIBRETA[2])],
        [heredoc('libreta.js', LIBRETA[3])],
        [heredoc('libreta.js', LIBRETA[4])],
        [
          heredoc('libreta.js', "\nmodule.exports = { agregar, buscar, eliminar, listar, guardar, cargar }\n"),
          heredoc(
            'prueba.js',
            `const assert = require('node:assert')\nconst l = require('./libreta')\nconst lib = []\nl.agregar(lib, 'Zoe', '111')\nl.agregar(lib, 'ana', '222')\nassert.strictEqual(l.buscar(lib, 'an').length, 1)\nassert.deepStrictEqual(l.listar(lib).map((c) => c.nombre), ['ana', 'Zoe'])\nassert.strictEqual(l.eliminar(lib, 'ZOE'), true)\nconsole.log('ok')\n`,
            '>'
          ),
          bash('node prueba.js', 'Corre la prueba')
        ],
        [heredoc('README.md', '# Libreta\n\nFunciones: agregar, buscar, eliminar, listar, guardar, cargar y exportarCsv.\n\nEjemplo: `agregar(lib, "Ana", "123")`.\n', '>')],
        [
          heredoc(
            'libreta.js',
            `\nfunction exportarCsv(libreta) {\n  return ['nombre,telefono', ...listar(libreta).map((c) => c.nombre + ',' + c.telefono)].join('\\n') + '\\n'\n}\nmodule.exports.exportarCsv = exportarCsv\n`
          ),
          heredoc('prueba.js', `assert.strictEqual(l.exportarCsv([{ nombre: 'ana', telefono: '1' }]), 'nombre,telefono\\nana,1\\n')\n`),
          bash('node prueba.js', 'Corre la prueba')
        ]
      ],
      final: 'Hecho.'
    }
  }
}
