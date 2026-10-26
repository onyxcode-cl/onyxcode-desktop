// T22 — Pruebas que emiten unas 20 000 líneas con UN fallo escondido (caso 5000 del tramo). Mide: ganchos de salida (H5) y poda de resultados.
import { createHash } from 'node:crypto'
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash, editar, leerArchivo } from './_pasos.mjs'

const TARIFA = `// Tarifa de envío por peso (gramos). Tramos: hasta 1000 g, hasta 5000 g, hasta 15000 g y más.
function tarifa(gramos) {
  if (!Number.isInteger(gramos) || gramos <= 0) throw new RangeError('peso inválido')
  if (gramos <= 1000) return 2500
  if (gramos < 5000) return 4200
  if (gramos <= 15000) return 6900
  return 6900 + Math.ceil((gramos - 15000) / 1000) * 400
}

module.exports = { tarifa }
`
const ESPERADA = (g) => (g <= 1000 ? 2500 : g <= 5000 ? 4200 : g <= 15000 ? 6900 : 6900 + Math.ceil((g - 15000) / 1000) * 400)

const PRUEBAS = `// Pruebas de tarifa(): una línea por caso (de 1 a 20000 g). Sale con código 1 si algún caso falla.
const { tarifa } = require('./tarifa')
const esperada = (g) => (g <= 1000 ? 2500 : g <= 5000 ? 4200 : g <= 15000 ? 6900 : 6900 + Math.ceil((g - 15000) / 1000) * 400)
let fallos = 0
for (let g = 1; g <= 20000; g++) {
  const obtenido = tarifa(g)
  if (obtenido === esperada(g)) console.log('ok   caso ' + g + ' g -> ' + obtenido)
  else {
    fallos++
    console.log('FALLA caso ' + g + ' g: esperado ' + esperada(g) + ', obtenido ' + obtenido)
  }
}
console.log(fallos ? fallos + ' caso(s) fallaron de 20000' : 'todos los casos pasaron')
process.exitCode = fallos ? 1 : 0
`
const huella = (t) => createHash('sha256').update(t).digest('hex')

export default {
  id: 'T22',
  nombre: 'Pruebas con 20 000 líneas de salida y un fallo escondido',
  mide: 'Salida larga (ganchos de salida, poda)',
  categoria: 'programacion',
  pedidos: [
    'Corre `node pruebas.js`: debería pasar todo y no pasa. Encuentra la causa en tarifa.js y arréglala. No toques pruebas.js. Al terminar, `node pruebas.js` debe salir con código 0.'
  ],
  preparar(dir) {
    escribir(dir, 'tarifa.js', TARIFA)
    escribir(dir, 'pruebas.js', PRUEBAS)
  },
  verificar(dir) {
    if (huella(leer(dir, 'pruebas.js')) !== huella(PRUEBAS)) return falla('se modificó pruebas.js')
    const r = correr(process.execPath, ['pruebas.js'], { cwd: dir, timeoutMs: 60_000 })
    if (r.code !== 0) return falla(`pruebas.js sigue fallando: ${r.out.split('\n').filter((l) => l.startsWith('FALLA') || /fallaron/.test(l)).slice(0, 2).join(' | ')}`)
    // No vale «arreglar» desactivando casos: tarifa() debe seguir dando los mismos valores en puntos clave y fuera del rango de las pruebas.
    const c = correr(process.execPath, ['-e', `const {tarifa}=require('./tarifa');const e=${ESPERADA.toString()};const m=[1,999,1000,1001,4999,5000,5001,14999,15000,15001,16000,25000,99999];for(const g of m){if(tarifa(g)!==e(g)){console.log('mal '+g);process.exit(1)}}try{tarifa(0);console.log('sin error');process.exit(1)}catch(x){if(!(x instanceof RangeError))process.exit(1)}`], { cwd: dir })
    return c.code === 0 ? ok() : falla(`tarifa() cambió de comportamiento: ${c.out.slice(0, 100)}`)
  },
  guion: (dir) => ({
    turnos: [
      [
        bash('node pruebas.js | grep -n FALLA | head -5; node pruebas.js | tail -2', 'Busca el fallo entre la salida larga'),
        leerArchivo(dir, 'tarifa.js'),
        editar(dir, 'tarifa.js', 'if (gramos < 5000) return 4200', 'if (gramos <= 5000) return 4200'),
        bash('node pruebas.js | tail -2', 'Vuelve a correr las pruebas')
      ]
    ],
    final: 'La causa era el límite del segundo tramo: 5000 g debía costar 4200 (<= en vez de <).'
  })
}
