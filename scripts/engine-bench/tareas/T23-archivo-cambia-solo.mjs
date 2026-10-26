// T23 — Un «otro proceso» (la sincronización que lanza el propio pedido, con `sleep` en un shell de fondo) cambia precios.csv a mitad de la
// sesión. El modelo debe releer antes de escribir y no pisar esos cambios. Mide: avisos de cambio de archivo (H9/H10). Todo ocurre dentro de la
// carpeta temporal de la corrida.
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash, editar, leerArchivo } from './_pasos.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const FILAS = [
  ['pan', 'panadería', 1200, 40],
  ['leche', 'lácteos', 990, 120],
  ['queso', 'lácteos', 5400, 15],
  ['yogur', 'lácteos', 450, 200],
  ['manzana', 'frutas', 800, 90],
  ['pera', 'frutas', 700, 60],
  ['arroz', 'despensa', 1500, 75]
]
const CAB = 'producto,categoria,precio,stock'
const csv = (filas) => [CAB, ...filas.map((f) => f.join(','))].join('\n') + '\n'

// La sincronización: cambia el stock de dos filas y agrega un producto nuevo (no toca precios).
const SYNC_STOCK = { pan: 12, pera: 0 }
const NUEVO = ['galletas', 'despensa', 900, 50]
const SYNC = `const fs = require('node:fs')
setTimeout(() => {
  const l = fs.readFileSync('precios.csv', 'utf8').trim().split('\\n')
  const cambios = ${JSON.stringify(SYNC_STOCK)}
  const sal = l.map((x, i) => {
    if (i === 0) return x
    const c = x.split(',')
    if (c[0] in cambios) c[3] = String(cambios[c[0]])
    return c.join(',')
  })
  if (!sal.some((x) => x.startsWith('${NUEVO[0]},'))) sal.push('${NUEVO.join(',')}')
  fs.writeFileSync('precios.csv', sal.join('\\n') + '\\n')
  fs.writeFileSync('.sync-hecho', 'listo')
}, 6000)
`
const LANZAR = `#!/bin/sh
# Arranca en segundo plano la sincronización del equipo (tarda unos segundos y actualiza precios.csv).
touch .sync-iniciado
nohup node sync.js >/dev/null 2>&1 &
echo "sincronización iniciada"
`

const final = () => {
  const f = FILAS.map((r) => [...r])
  for (const r of f) {
    if (r[1] === 'lácteos') r[2] = Math.round(r[2] * 1.1)
    if (r[0] in SYNC_STOCK) r[3] = SYNC_STOCK[r[0]]
  }
  f.push([...NUEVO])
  return f
}

export default {
  id: 'T23',
  nombre: 'Un archivo cambia mientras trabajas',
  mide: 'Avisos de cambio de archivo (releer antes de escribir)',
  categoria: 'programacion',
  pedidos: [
    'Corre `sh lanzar-sync.sh`: arranca la sincronización del equipo, que en unos segundos actualiza el stock de precios.csv y agrega productos nuevos. Mientras tanto, sube un 10 % el precio de todos los productos de la categoría lácteos en precios.csv (redondea al entero más cercano; los demás precios no cambian). Al terminar, el archivo debe tener tanto tus cambios como los de la sincronización: no se puede perder ninguno.'
  ],
  preparar(dir) {
    escribir(dir, 'precios.csv', csv(FILAS))
    escribir(dir, 'sync.js', SYNC)
    escribir(dir, 'lanzar-sync.sh', LANZAR)
  },
  verificar(dir) {
    if (!existsSync(join(dir, '.sync-iniciado'))) return falla('no se lanzó la sincronización')
    // Si el ejecutor cortó el proceso de fondo antes de que terminara (el modelo acabó pronto), el «otro proceso» termina aquí su trabajo:
    // sync.js es idempotente y solo toca el stock de dos filas y agrega un producto, así que sobre un archivo bien editado no cambia nada más.
    if (!existsSync(join(dir, '.sync-hecho'))) correr(process.execPath, ['sync.js'], { cwd: dir, timeoutMs: 30_000 })
    if (!existsSync(join(dir, '.sync-hecho'))) return falla('la sincronización no terminó')
    const t = leer(dir, 'precios.csv').replace(/\r\n/g, '\n')
    if (t === csv(final())) return ok()
    const a = t.split('\n')
    const e = csv(final()).split('\n')
    for (let i = 0; i < Math.max(a.length, e.length); i++) if (a[i] !== e[i]) return falla(`precios.csv línea ${i + 1}: «${a[i] ?? ''}» ≠ «${e[i] ?? ''}»`)
    return falla('precios.csv no coincide')
  },
  guion: (dir) => ({
    turnos: [
      [
        bash('sh lanzar-sync.sh', 'Lanza la sincronización'),
        leerArchivo(dir, 'precios.csv'),
        bash('sleep 8', 'Espera a que la sincronización termine'),
        leerArchivo(dir, 'precios.csv'),
        editar(dir, 'precios.csv', 'leche,lácteos,990,120', 'leche,lácteos,1089,120'),
        editar(dir, 'precios.csv', 'queso,lácteos,5400,15', 'queso,lácteos,5940,15'),
        editar(dir, 'precios.csv', 'yogur,lácteos,450,200', 'yogur,lácteos,495,200')
      ]
    ],
    final: 'Listo: subí los lácteos un 10 % y conservé los cambios de la sincronización.'
  })
}
