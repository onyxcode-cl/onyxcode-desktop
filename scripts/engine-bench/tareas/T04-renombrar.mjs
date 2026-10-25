// T04 — Renombrar un símbolo en 5 archivos. Mide: ediciones múltiples.
import { escribir, falla, leer, node, ok } from '../lib.mjs'
import { bash, buscar } from './_pasos.mjs'

const ARCHIVOS = {
  'impuestos.js': `// Cálculo de impuestos.
const TASA = 0.19

// calcularImpuesto devuelve el IVA de un monto neto.
function calcularImpuesto(neto) {
  return Math.round(neto * TASA)
}

module.exports = { calcularImpuesto, TASA }
`,
  'facturas.js': `const { calcularImpuesto } = require('./impuestos')

function totalFactura(neto) {
  return neto + calcularImpuesto(neto)
}

module.exports = { totalFactura }
`,
  'boletas.js': `const impuestos = require('./impuestos')

function totalBoleta(bruto) {
  // La boleta ya incluye IVA: se separa con calcularImpuesto sobre el neto.
  const neto = Math.round(bruto / (1 + impuestos.TASA))
  return { neto, iva: impuestos.calcularImpuesto(neto), bruto }
}

module.exports = { totalBoleta }
`,
  'reportes.js': `const { calcularImpuesto } = require('./impuestos')

function resumenIva(montos) {
  const total = montos.reduce((acc, m) => acc + calcularImpuesto(m), 0)
  return 'IVA total: ' + total + ' (calculado con calcularImpuesto)'
}

module.exports = { resumenIva }
`,
  'prueba.js': `const assert = require('node:assert')
const { calcularImpuesto } = require('./impuestos')
const { totalFactura } = require('./facturas')
const { totalBoleta } = require('./boletas')
const { resumenIva } = require('./reportes')

assert.strictEqual(calcularImpuesto(1000), 190)
assert.strictEqual(totalFactura(1000), 1190)
assert.deepStrictEqual(totalBoleta(1190), { neto: 1000, iva: 190, bruto: 1190 })
assert.strictEqual(resumenIva([1000, 2000]), 'IVA total: 570 (calculado con calcularImpuesto)')
console.log('todo bien')
`
}

export default {
  id: 'T04',
  nombre: 'Renombrar un símbolo en 5 archivos',
  mide: 'Ediciones múltiples',
  categoria: 'programacion',
  pedidos: [
    'Renombra la función `calcularImpuesto` a `calcularIva` en todo el proyecto: la definición, los usos, los comentarios, los textos y la prueba. Al final `node prueba.js` debe seguir pasando.'
  ],
  preparar(dir) {
    for (const [n, t] of Object.entries(ARCHIVOS)) escribir(dir, n, t)
  },
  verificar(dir) {
    for (const n of Object.keys(ARCHIVOS)) {
      const t = leer(dir, n)
      if (t.includes('calcularImpuesto')) return falla(`queda calcularImpuesto en ${n}`)
    }
    if (!leer(dir, 'impuestos.js').includes('function calcularIva(')) return falla('no se renombró la definición')
    const r = node(dir, 'prueba.js')
    return r.code === 0 ? ok() : falla(`prueba.js falla: ${r.out.slice(0, 200)}`)
  },
  guion: () => ({
    turnos: [[buscar('calcularImpuesto', undefined, '*.js'), bash("sed -i 's/calcularImpuesto/calcularIva/g' *.js", 'Renombra en todos los archivos'), bash('node prueba.js', 'Corre la prueba')]],
    final: 'Renombré calcularImpuesto a calcularIva en los 5 archivos; la prueba pasa.'
  })
}
