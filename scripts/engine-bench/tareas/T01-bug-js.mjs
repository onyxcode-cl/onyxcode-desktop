// T01 — Arreglar un bug con una prueba que falla (JavaScript). Mide: lectura justa y edición.
import { correr, escribir, falla, leer, node, ok, sha } from '../lib.mjs'
import { bash, editar, leerArchivo } from './_pasos.mjs'

const CARRITO = `// Carrito de compras: cálculos básicos en pesos chilenos.
function subtotal(items) {
  return items.reduce((acc, it) => acc + it.precio * it.cantidad, 0)
}

// El porcentaje llega entre 0 y 100 (15 = 15 %).
function aplicarDescuento(monto, porcentaje) {
  return monto - (monto * porcentaje) / 10
}

function totalConIva(monto) {
  return Math.round(monto * 1.19)
}

function contarArticulos(items) {
  return items.reduce((acc, it) => acc + it.cantidad, 0)
}

function formatearCLP(monto) {
  return '$' + Math.round(monto).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')
}

module.exports = { subtotal, aplicarDescuento, totalConIva, contarArticulos, formatearCLP }
`

const PRUEBA = `const assert = require('node:assert')
const c = require('./carrito')

const items = [
  { precio: 1000, cantidad: 2 },
  { precio: 500, cantidad: 1 }
]
assert.strictEqual(c.subtotal(items), 2500)
assert.strictEqual(c.contarArticulos(items), 3)
assert.strictEqual(c.aplicarDescuento(1000, 15), 850)
assert.strictEqual(c.totalConIva(1000), 1190)
assert.strictEqual(c.formatearCLP(1234567), '$1.234.567')
console.log('todo bien')
`

export default {
  id: 'T01',
  nombre: 'Arreglar un bug con prueba que falla (JS)',
  mide: 'Lectura justa, edición',
  categoria: 'programacion',
  pedidos: ['Mi prueba `node prueba.js` falla. Encuentra el error en el código del carrito y arréglalo, sin tocar el archivo de la prueba.'],
  preparar(dir) {
    escribir(dir, 'carrito.js', CARRITO)
    escribir(dir, 'prueba.js', PRUEBA)
  },
  verificar(dir) {
    const r = node(dir, 'prueba.js')
    if (r.code !== 0) return falla(`prueba.js sigue fallando: ${r.out.slice(0, 200)}`)
    if (sha(leer(dir, 'prueba.js')) !== sha(PRUEBA)) return falla('se modificó prueba.js')
    const extra = correr(process.execPath, [
      '-e',
      "const c=require('./carrito');const a=require('node:assert');a.strictEqual(c.aplicarDescuento(2000,10),1800);a.strictEqual(c.aplicarDescuento(999,0),999)"
    ], { cwd: dir })
    return extra.code === 0 ? ok() : falla('el descuento sigue mal con otros valores')
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'carrito.js'),
        editar(dir, 'carrito.js', '(monto * porcentaje) / 10', '(monto * porcentaje) / 100'),
        bash('node prueba.js', 'Corre la prueba')
      ]
    ],
    final: 'Corregí aplicarDescuento: dividía entre 10 en vez de entre 100. La prueba pasa.'
  })
}
