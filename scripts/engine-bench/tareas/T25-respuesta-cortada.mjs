// T25 — La respuesta del modelo se corta (`finish_reason: "length"`) a mitad de la llamada que escribe un archivo grande. Mide: respuesta cortada (7.4).
// Solo se puede producir con el proveedor falso (un modelo real no se corta a voluntad): `requiere: ['proveedor-falso']`. El guion emite primero la
// llamada `write` con los argumentos cortados por la mitad; si el motor la ejecutara tal cual (JSON roto) o la dejara a medias, el archivo sale mal.
// La solución de referencia reintenta en piezas pequeñas (un generador corto), que es lo que debería inducir el motor.
import { correr, escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo } from './_pasos.mjs'

const N = 150
function filas() {
  const r = prng(2502)
  const regiones = ['Norte', 'Centro', 'Sur', 'Austral', 'Insular']
  return Array.from({ length: N }, (_, i) => ({ codigo: 1000 + i, nombre: `Comuna ${String(i + 1).padStart(3, '0')}`, region: r.pick(regiones), poblacion: r.int(1500, 480000) }))
}
const CSV = () => ['codigo,nombre,region,poblacion', ...filas().map((f) => `${f.codigo},${f.nombre},${f.region},${f.poblacion}`)].join('\n') + '\n'
const datosJs = () => `// Generado a partir de comunas.csv\nmodule.exports = { comunas: ${JSON.stringify(filas(), null, 2)} }\n`
const GENERADOR = `const fs = require('node:fs')
const [cab, ...l] = fs.readFileSync('comunas.csv', 'utf8').trim().split('\\n')
const comunas = l.map((x) => { const [codigo, nombre, region, poblacion] = x.split(','); return { codigo: Number(codigo), nombre, region, poblacion: Number(poblacion) } })
fs.writeFileSync('datos.js', '// Generado a partir de comunas.csv\\nmodule.exports = { comunas: ' + JSON.stringify(comunas, null, 2) + ' }\\n')
`

export default {
  id: 'T25',
  nombre: 'Respuesta cortada en mitad de un archivo grande',
  mide: 'Respuesta cortada (finish: length)',
  categoria: 'programacion',
  requiere: ['proveedor-falso'],
  pedidos: [
    `Convierte comunas.csv (${N} filas) en \`datos.js\`: un módulo CommonJS que exporte \`comunas\`, un arreglo de objetos \`{ codigo, nombre, region, poblacion }\` con \`codigo\` y \`poblacion\` como números, en el mismo orden del CSV.`
  ],
  preparar(dir) {
    escribir(dir, 'comunas.csv', CSV())
  },
  verificar(dir) {
    try {
      leer(dir, 'datos.js')
    } catch {
      return falla('no existe datos.js')
    }
    const r = correr(process.execPath, ['-e', `const {comunas}=require('./datos.js');const e=${JSON.stringify(filas())};if(!Array.isArray(comunas)||comunas.length!==e.length){console.log('largo '+(comunas&&comunas.length));process.exit(1)}for(let i=0;i<e.length;i++){const a=comunas[i],b=e[i];if(a.codigo!==b.codigo||a.nombre!==b.nombre||a.region!==b.region||a.poblacion!==b.poblacion){console.log('fila '+i);process.exit(1)}}`], { cwd: dir })
    return r.code === 0 ? ok() : falla(`datos.js no coincide con el CSV: ${r.out.trim().slice(0, 120)}`)
  },
  guion: (dir) => ({
    turnos: [
      [
        // Primer intento: el archivo entero en un solo `write`, que el proveedor corta por la mitad con finish: length.
        { ...escribirArchivo(dir, 'datos.js', datosJs()), truncar: true, sinEfecto: true },
        // Reintento en piezas pequeñas: un generador corto y correrlo.
        escribirArchivo(dir, 'generar.js', GENERADOR),
        bash('node generar.js', 'Genera datos.js a partir del CSV')
      ]
    ],
    final: 'Mi primera respuesta se cortó; generé datos.js con un script corto a partir del CSV.'
  })
}
