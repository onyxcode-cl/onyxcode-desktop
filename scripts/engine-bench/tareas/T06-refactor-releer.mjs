// T06 — Refactor que obliga a releer el mismo archivo (funciones duplicadas en 3 módulos). Mide: no releer.
import { escribir, falla, leer, node, ok } from '../lib.mjs'
import { editar, escribirArchivo, leerArchivo, bash } from './_pasos.mjs'

const DUP = `function formatearMonto(n) {
  return '$' + Math.round(n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')
}

function formatearFecha(iso) {
  const [a, m, d] = iso.split('-')
  return d + '/' + m + '/' + a
}
`

const MODULOS = {
  'ventas.js': `// Resumen de ventas.
${DUP}
function resumenVentas(ventas) {
  return ventas.map((v) => formatearFecha(v.fecha) + ': ' + formatearMonto(v.monto)).join('\\n')
}

function totalVentas(ventas) {
  return formatearMonto(ventas.reduce((acc, v) => acc + v.monto, 0))
}

module.exports = { resumenVentas, totalVentas }
`,
  'compras.js': `// Resumen de compras.
${DUP}
function resumenCompras(compras) {
  return compras.map((c) => formatearFecha(c.fecha) + ' ' + c.proveedor + ': ' + formatearMonto(c.monto)).join('\\n')
}

function mayorCompra(compras) {
  const m = compras.reduce((a, c) => (c.monto > a.monto ? c : a))
  return m.proveedor + ' (' + formatearMonto(m.monto) + ')'
}

module.exports = { resumenCompras, mayorCompra }
`,
  'gastos.js': `// Resumen de gastos.
${DUP}
function resumenGastos(gastos) {
  return gastos.map((g) => g.concepto + ' el ' + formatearFecha(g.fecha) + ': ' + formatearMonto(g.monto)).join('\\n')
}

function promedioGasto(gastos) {
  return formatearMonto(gastos.reduce((acc, g) => acc + g.monto, 0) / gastos.length)
}

module.exports = { resumenGastos, promedioGasto }
`
}

const PRUEBA = `const assert = require('node:assert')
const v = require('./ventas')
const c = require('./compras')
const g = require('./gastos')

const ventas = [{ fecha: '2025-03-01', monto: 1234567 }, { fecha: '2025-03-02', monto: 500 }]
assert.strictEqual(v.resumenVentas(ventas), '01/03/2025: $1.234.567\\n02/03/2025: $500')
assert.strictEqual(v.totalVentas(ventas), '$1.235.067')
const compras = [{ fecha: '2025-02-10', proveedor: 'Acme', monto: 90000 }, { fecha: '2025-02-11', proveedor: 'Beta', monto: 120000 }]
assert.strictEqual(c.resumenCompras(compras), '10/02/2025 Acme: $90.000\\n11/02/2025 Beta: $120.000')
assert.strictEqual(c.mayorCompra(compras), 'Beta ($120.000)')
const gastos = [{ fecha: '2025-01-05', concepto: 'Luz', monto: 30000 }, { fecha: '2025-01-06', concepto: 'Agua', monto: 10000 }]
assert.strictEqual(g.resumenGastos(gastos), 'Luz el 05/01/2025: $30.000\\nAgua el 06/01/2025: $10.000')
assert.strictEqual(g.promedioGasto(gastos), '$20.000')
console.log('todo bien')
`

export default {
  id: 'T06',
  nombre: 'Refactor que obliga a releer el mismo archivo',
  mide: 'No releer',
  categoria: 'programacion',
  pedidos: [
    'Los tres módulos (ventas.js, compras.js y gastos.js) repiten las funciones `formatearMonto` y `formatearFecha`. Muévelas a un archivo nuevo `formato.js`, impórtalas desde ahí en los tres módulos y borra las copias. `node prueba.js` debe seguir pasando.'
  ],
  preparar(dir) {
    for (const [n, t] of Object.entries(MODULOS)) escribir(dir, n, t)
    escribir(dir, 'prueba.js', PRUEBA)
  },
  verificar(dir) {
    let f
    try {
      f = leer(dir, 'formato.js')
    } catch {
      return falla('no existe formato.js')
    }
    if (!/formatearMonto/.test(f) || !/formatearFecha/.test(f)) return falla('formato.js no define las dos funciones')
    for (const n of Object.keys(MODULOS)) {
      const t = leer(dir, n)
      if (/function formatearMonto|function formatearFecha/.test(t)) return falla(`${n} conserva una copia`)
      if (!/require\(['"]\.\/formato(\.js)?['"]\)/.test(t)) return falla(`${n} no importa formato.js`)
    }
    const r = node(dir, 'prueba.js')
    return r.code === 0 ? ok() : falla(`prueba.js falla: ${r.out.slice(0, 200)}`)
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'ventas.js'),
        leerArchivo(dir, 'compras.js'),
        leerArchivo(dir, 'gastos.js'),
        escribirArchivo(dir, 'formato.js', DUP + "\nmodule.exports = { formatearMonto, formatearFecha }\n"),
        editar(dir, 'ventas.js', DUP, "const { formatearMonto, formatearFecha } = require('./formato')\n"),
        editar(dir, 'compras.js', DUP, "const { formatearMonto, formatearFecha } = require('./formato')\n"),
        editar(dir, 'gastos.js', DUP, "const { formatearMonto, formatearFecha } = require('./formato')\n"),
        bash('node prueba.js', 'Corre la prueba')
      ]
    ],
    final: 'Moví formatearMonto y formatearFecha a formato.js y los tres módulos los importan.'
  })
}
