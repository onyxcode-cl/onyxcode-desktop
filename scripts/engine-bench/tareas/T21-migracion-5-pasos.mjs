// T21 — Migración de 5 pasos con dependencias reales: cada comprobación `node comprobar.js N` se niega si el paso N-1 no quedó
// comprobado (y el 3 falla de verdad si el 2 no se hizo). Mide: tareas con dependencias (H11).
import { createHash } from 'node:crypto'
import { correr, escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo, leerArchivo } from './_pasos.mjs'

const NOMBRES = ['Ana Pérez', 'Luis Muñoz', 'Carla Soto', 'Diego Rojas', 'Elena Vidal', 'Franco Díaz', 'Gloria Paz']
const ADMINS = [2, 5]

const original = () => {
  const r = prng(2121)
  return NOMBRES.map((nombre, i) => ({ id: i + 1, nombre, edad: String(r.int(19, 64)), activo: r() < 0.7 ? 'si' : 'no' }))
}
const v2 = () => original().map((u) => ({ id: u.id, nombreCompleto: u.nombre, edad: Number(u.edad), activo: u.activo === 'si' }))
const conRol = () => v2().map((u) => ({ ...u, rol: ADMINS.includes(u.id) ? 'admin' : 'lector' }))
const indice = () => Object.fromEntries(v2().map((u) => [String(u.id), u.nombreCompleto]))
const resumen = () => `usuarios: ${NOMBRES.length}\nadmins: ${ADMINS.length}\nactivos: ${v2().filter((u) => u.activo).length}\n`
const json = (x) => JSON.stringify(x, null, 2) + '\n'
const huella = (t) => createHash('sha256').update(t).digest('hex')

const MIGRACION = `# Migración de usuarios (5 pasos, en orden)

Parte de \`datos/usuarios.json\` (formato viejo). Tras cada paso corre \`node comprobar.js <N>\`: comprueba el resultado y solo deja pasar al
siguiente si el anterior quedó comprobado.

1. **Respaldo**: copia \`datos/usuarios.json\` a \`respaldo/usuarios.v1.json\` sin cambiarlo.
2. **Formato nuevo** en \`datos/usuarios.json\`: \`nombre\` pasa a \`nombreCompleto\`; \`edad\` (texto) pasa a número; \`activo\` ("si"/"no") pasa a booleano.
3. **Índice**: crea \`datos/indice.json\`, un objeto \`{ "<id>": "<nombreCompleto>" }\` con todos los usuarios (sale del archivo ya migrado en el paso 2).
4. **Roles**: agrega \`rol\` a cada usuario de \`datos/usuarios.json\`: \`"admin"\` para los ids 2 y 5, \`"lector"\` para el resto.
5. **Resumen**: escribe \`resumen.txt\` con tres líneas exactas: \`usuarios: N\`, \`admins: M\` y \`activos: K\` (K = usuarios con activo verdadero).
`

const COMPROBAR = `// uso: node comprobar.js <N>. Comprueba el paso N y, si está bien, lo anota en .estado y en migracion.log.
const fs = require('node:fs')
const crypto = require('node:crypto')
const n = Number(process.argv[2])
const leer = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const hecho = fs.existsSync('.estado') ? Number(fs.readFileSync('.estado', 'utf8')) : 0
const fallar = (m) => { console.log('PASO ' + n + ' FALLA: ' + m); process.exit(1) }
if (!(n >= 1 && n <= 5)) fallar('uso: node comprobar.js <1-5>')
if (hecho !== n - 1) fallar('antes hay que dejar comprobado el paso ' + (n - 1) + ' (último comprobado: ' + hecho + ')')
try {
  const u = leer('datos/usuarios.json')
  if (n === 1) {
    const a = fs.readFileSync('datos/usuarios.json', 'utf8')
    if (!fs.existsSync('respaldo/usuarios.v1.json')) fallar('falta respaldo/usuarios.v1.json')
    if (fs.readFileSync('respaldo/usuarios.v1.json', 'utf8') !== a) fallar('el respaldo no es idéntico al original')
  } else if (n === 2) {
    if (!fs.existsSync('respaldo/usuarios.v1.json')) fallar('falta el respaldo del paso 1')
    for (const x of u) if (!('nombreCompleto' in x) || 'nombre' in x || typeof x.edad !== 'number' || typeof x.activo !== 'boolean') fallar('usuario ' + x.id + ' sin el formato nuevo')
  } else if (n === 3) {
    if (u.some((x) => 'nombre' in x)) fallar('el paso 2 no se hizo: aún hay campos «nombre»')
    const i = leer('datos/indice.json')
    if (Object.keys(i).length !== u.length || u.some((x) => i[String(x.id)] !== x.nombreCompleto)) fallar('datos/indice.json no coincide con los usuarios')
  } else if (n === 4) {
    for (const x of u) if (x.rol !== ([2, 5].includes(x.id) ? 'admin' : 'lector')) fallar('rol incorrecto en el usuario ' + x.id)
  } else if (n === 5) {
    const t = fs.readFileSync('resumen.txt', 'utf8').trim().split(/\\r?\\n/)
    const esperado = ['usuarios: ' + u.length, 'admins: ' + u.filter((x) => x.rol === 'admin').length, 'activos: ' + u.filter((x) => x.activo).length]
    if (JSON.stringify(t) !== JSON.stringify(esperado)) fallar('resumen.txt debería ser ' + JSON.stringify(esperado))
  }
} catch (e) { fallar(String(e.message)) }
fs.writeFileSync('.estado', String(n))
fs.appendFileSync('migracion.log', 'paso' + n + ' ok\\n')
console.log('PASO ' + n + ' OK')
`

export default {
  id: 'T21',
  nombre: 'Migración de 5 pasos con dependencias',
  mide: 'Tareas con dependencias',
  categoria: 'programacion',
  pedidos: [
    'Haz la migración de usuarios que describe MIGRACION.md, los 5 pasos en orden. Después de cada paso corre `node comprobar.js <N>` y no sigas hasta que dé OK; si falla, arregla lo que falte antes de continuar. No modifiques comprobar.js.'
  ],
  preparar(dir) {
    escribir(dir, 'MIGRACION.md', MIGRACION)
    escribir(dir, 'comprobar.js', COMPROBAR)
    escribir(dir, 'datos/usuarios.json', json(original()))
  },
  verificar(dir) {
    const lee = (r) => {
      try {
        return leer(dir, r)
      } catch {
        return null
      }
    }
    if (lee('respaldo/usuarios.v1.json') !== json(original())) return falla('el respaldo falta o no es el original')
    if (huella(lee('comprobar.js') ?? '') !== huella(COMPROBAR)) return falla('se modificó comprobar.js')
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    let u
    try {
      u = JSON.parse(lee('datos/usuarios.json'))
    } catch {
      return falla('datos/usuarios.json ilegible')
    }
    const canon = (x) => x.map((o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
    if (!eq(canon(u), canon(conRol()))) return falla('datos/usuarios.json no coincide con el resultado final esperado')
    let i
    try {
      i = JSON.parse(lee('datos/indice.json'))
    } catch {
      return falla('falta datos/indice.json')
    }
    if (!eq(Object.entries(i).sort(), Object.entries(indice()).sort())) return falla('datos/indice.json incorrecto')
    if ((lee('resumen.txt') ?? '').trim() !== resumen().trim()) return falla('resumen.txt incorrecto')
    if (lee('migracion.log') !== 'paso1 ok\npaso2 ok\npaso3 ok\npaso4 ok\npaso5 ok\n') return falla(`los pasos no se comprobaron en orden: ${JSON.stringify(lee('migracion.log'))}`)
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'MIGRACION.md'),
        bash('mkdir -p respaldo && cp datos/usuarios.json respaldo/usuarios.v1.json', 'Paso 1: respaldo'),
        bash('node comprobar.js 1', 'Comprueba el paso 1'),
        escribirArchivo(dir, 'datos/usuarios.json', json(v2())),
        bash('node comprobar.js 2', 'Comprueba el paso 2'),
        escribirArchivo(dir, 'datos/indice.json', json(indice())),
        bash('node comprobar.js 3', 'Comprueba el paso 3'),
        escribirArchivo(dir, 'datos/usuarios.json', json(conRol())),
        bash('node comprobar.js 4', 'Comprueba el paso 4'),
        escribirArchivo(dir, 'resumen.txt', resumen()),
        bash('node comprobar.js 5', 'Comprueba el paso 5')
      ]
    ],
    final: 'Migración completa: los cinco pasos dieron OK en orden.'
  })
}
