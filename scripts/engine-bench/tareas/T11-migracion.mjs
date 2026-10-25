// T11 — Migración con verificación por paso (4 archivos de configuración v1 → v2). Mide: plan ejecutable (ola 2).
import { escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo, leerArchivo } from './_pasos.mjs'

const NOMBRES = ['api-ventas', 'api-pagos', 'worker-correo', 'panel-admin']

const origenes = () => {
  const r = prng(1111)
  return NOMBRES.map((nombre) => ({ nombre, puerto: String(r.int(3000, 9000)), debug: r() < 0.5 ? 'true' : 'false', tiempoEsperaSeg: String(r.int(5, 60)) }))
}
const aV2 = (o) => ({ version: 2, servidor: { nombre: o.nombre, puerto: Number(o.puerto), tiempoEsperaMs: Number(o.tiempoEsperaSeg) * 1000 }, depuracion: o.debug === 'true' })

const MIGRACION = `# Migración de la configuración v1 → v2

Cada archivo de \`config/\` pasa de esto (v1):

    { "nombre": "x", "puerto": "8080", "debug": "true", "tiempoEsperaSeg": "30" }

a esto (v2):

    { "version": 2, "servidor": { "nombre": "x", "puerto": 8080, "tiempoEsperaMs": 30000 }, "depuracion": true }

Reglas: \`puerto\` pasa a número; \`debug\` ("true"/"false") pasa a \`depuracion\` booleano; \`tiempoEsperaSeg\` (texto, segundos) pasa a
\`servidor.tiempoEsperaMs\` (número, milisegundos). No debe quedar ninguna clave de v1. El orden de las claves no importa.
`

const VERIFICAR = `// Revisa cada archivo de config/: OK (ya está en v2 y bien formado), PENDIENTE (aún v1) o FALLA (v2 mal hecho).
const fs = require('node:fs')
const path = require('node:path')
let mal = 0
for (const f of fs.readdirSync('config').filter((n) => n.endsWith('.json')).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join('config', f), 'utf8'))
  if (j.version !== 2) { console.log('PENDIENTE ' + f); continue }
  const s = j.servidor || {}
  const bien = typeof s.nombre === 'string' && Number.isInteger(s.puerto) && Number.isInteger(s.tiempoEsperaMs) && typeof j.depuracion === 'boolean' &&
    !('puerto' in j) && !('debug' in j) && !('nombre' in j) && !('tiempoEsperaSeg' in j)
  console.log((bien ? 'OK ' : 'FALLA ') + f)
  if (!bien) mal++
}
process.exit(mal ? 1 : 0)
`

export default {
  id: 'T11',
  nombre: 'Migración con verificación por paso',
  mide: 'Plan ejecutable',
  categoria: 'programacion',
  pedidos: [
    'Migra los 4 archivos de config/ del formato v1 al v2 que describe MIGRACION.md. Hazlo uno por uno y, después de cada archivo, corre `node verificar.js` para confirmar que ese archivo quedó bien antes de seguir con el siguiente.'
  ],
  preparar(dir) {
    escribir(dir, 'MIGRACION.md', MIGRACION)
    escribir(dir, 'verificar.js', VERIFICAR)
    for (const o of origenes()) escribir(dir, `config/${o.nombre}.json`, JSON.stringify(o, null, 2) + '\n')
  },
  verificar(dir) {
    for (const o of origenes()) {
      let j
      try {
        j = JSON.parse(leer(dir, `config/${o.nombre}.json`))
      } catch (e) {
        return falla(`${o.nombre}.json ilegible o ausente`)
      }
      if (JSON.stringify(canon(j)) !== JSON.stringify(canon(aV2(o)))) return falla(`${o.nombre}.json no coincide con el v2 esperado`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'MIGRACION.md'),
        ...origenes().flatMap((o) => [
          escribirArchivo(dir, `config/${o.nombre}.json`, JSON.stringify(aV2(o), null, 2) + '\n'),
          bash('node verificar.js', `Verifica ${o.nombre}`)
        ])
      ]
    ],
    final: 'Migré los 4 archivos a v2 y verificar.js los da por buenos.'
  })
}

/** Forma canónica: claves ordenadas (el orden no importa). */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  return v
}
