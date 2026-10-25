// T15 — Lote: el mismo cambio en 3 módulos independientes. Mide: `/lote` (ola 4).
import { correr, escribir, falla, ok } from '../lib.mjs'
import { bash, editar } from './_pasos.mjs'

const MODULOS = ['ventas', 'compras', 'stock']

const REGISTRO = (m) => `// Registro de ${m}.
function registrar(lista, item) {
  lista.push(item)
  return lista.length
}

module.exports = { registrar }
`

const PRUEBA = (m) => `const assert = require('node:assert')
const { registrar } = require('./registro')
const lista = []
assert.strictEqual(registrar(lista, { id: 1, detalle: '${m}' }), 1)
assert.strictEqual(registrar(lista, { id: 2, detalle: '${m} 2' }), 2)
console.log('${m}: bien')
`

const VERIF = `const assert = require('node:assert')
const { registrar } = require('./registro')
for (const malo of [{}, { id: 0 }, { id: -3 }, { id: 'x' }, { id: 1.5 }, null]) {
  assert.throws(() => registrar([], malo), (e) => e instanceof Error && e.message === 'item inválido', 'debió rechazar ' + JSON.stringify(malo))
}
assert.strictEqual(registrar([], { id: 7 }), 1)
console.log('ok')
`

export default {
  id: 'T15',
  nombre: 'Lote: 3 módulos independientes',
  mide: '/lote (ola 4)',
  categoria: 'programacion',
  pedidos: [
    'Los tres módulos (`ventas/`, `compras/` y `stock/`) tienen su propio registro.js con la función `registrar(lista, item)`. En cada uno haz que `registrar` lance `new Error("item inválido")` cuando `item.id` no sea un entero positivo (o cuando item sea nulo). Cada módulo tiene su prueba.js: déjalas pasando. Los módulos son independientes entre sí.'
  ],
  preparar(dir) {
    for (const m of MODULOS) {
      escribir(dir, `${m}/registro.js`, REGISTRO(m))
      escribir(dir, `${m}/prueba.js`, PRUEBA(m))
    }
  },
  verificar(dir) {
    for (const m of MODULOS) {
      const p = correr(process.execPath, ['prueba.js'], { cwd: `${dir}/${m}` })
      if (p.code !== 0) return falla(`${m}/prueba.js falla: ${p.out.slice(0, 160)}`)
      escribir(dir, `${m}/__verif.js`, VERIF)
      const v = correr(process.execPath, ['__verif.js'], { cwd: `${dir}/${m}` })
      if (v.code !== 0) return falla(`${m}: validación incompleta: ${v.out.slice(0, 200)}`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        ...MODULOS.map((m) =>
          editar(
            dir,
            `${m}/registro.js`,
            'function registrar(lista, item) {\n',
            "function registrar(lista, item) {\n  if (!item || !Number.isInteger(item.id) || item.id <= 0) throw new Error('item inválido')\n"
          )
        ),
        bash('for m in ventas compras stock; do (cd $m && node prueba.js); done', 'Corre las pruebas de los tres módulos')
      ]
    ],
    final: 'Los tres módulos validan item.id y sus pruebas pasan.'
  })
}
