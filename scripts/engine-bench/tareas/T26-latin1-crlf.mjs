// T26 — Un archivo Latin-1 y otro con finales de línea mixtos (CRLF y LF) que hay que editar SIN corromperlos. Mide: edición segura (7.8).
// El verificador compara BYTE A BYTE contra el original con solo los reemplazos pedidos: ni UTF-8 reescrito, ni finales de línea normalizados.
import { falla, ok } from '../lib.mjs'
import { bash } from './_pasos.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Todo el texto es representable en Latin-1 (á é í ó ú ñ ü). Los reemplazos pedidos son solo ASCII.
const LATIN1 = 'INVENTARIO DE BODEGA - versión 3\n' +
  'Ubicación: pasillo 4, estantería ñandú\n' +
  'Responsable: José Muñoz Peña\n' +
  'Descripción: tubos de acero galvanizado, 6 m\n' +
  'Cantidad: 12 unidades\n' +
  'Observación: revisión mensual según norma técnica\n'
const MIXTO = ['LISTA DE PRECIOS - temporada', 'Producto: aceite de oliva extra virgen', 'Precio: 4500 pesos', 'Stock: 7 unidades', 'Origen: Colchagua', 'Nota: precios sin IVA', 'Fin de la lista']
// Finales mixtos: la mayoría CRLF, dos líneas solo LF (la de «Stock» y la penúltima) y la última sin final.
const FINALES = ['\r\n', '\r\n', '\r\n', '\n', '\r\n', '\n', '']
const mixtoBytes = () => Buffer.from(MIXTO.map((l, i) => l + FINALES[i]).join(''), 'latin1')
const latinBytes = () => Buffer.from(LATIN1, 'latin1')

const reemplazar = (buf, a, b) => {
  const t = buf.toString('latin1')
  if (!t.includes(a)) throw new Error(`falta «${a}»`)
  return Buffer.from(t.replace(a, b), 'latin1')
}
const esperadoLatin = () => reemplazar(latinBytes(), 'Cantidad: 12', 'Cantidad: 15')
const esperadoMixto = () => reemplazar(reemplazar(mixtoBytes(), 'Precio: 4500', 'Precio: 4900'), 'Stock: 7', 'Stock: 9')

function comparar(dir, nombre, esperado) {
  let real
  try {
    real = readFileSync(join(dir, nombre))
  } catch {
    return `no existe ${nombre}`
  }
  if (real.equals(esperado)) return null
  if (real.includes(Buffer.from([0xef, 0xbf, 0xbd]))) return `${nombre}: aparecen caracteres de reemplazo U+FFFD (se leyó Latin-1 como UTF-8)`
  if (Buffer.from(real.toString('utf8'), 'utf8').equals(real) && /[À-ÿ]/.test(real.toString('utf8'))) return `${nombre}: quedó reescrito como UTF-8`
  const crlf = (b) => (b.toString('latin1').match(/\r\n/g) ?? []).length
  if (crlf(real) !== crlf(esperado)) return `${nombre}: cambiaron los finales de línea (CRLF ${crlf(esperado)} → ${crlf(real)})`
  let i = 0
  while (i < Math.min(real.length, esperado.length) && real[i] === esperado[i]) i++
  return `${nombre}: difiere desde el byte ${i} (${real.length} bytes, se esperaban ${esperado.length})`
}

export default {
  id: 'T26',
  nombre: 'Editar un Latin-1 y un archivo con finales mixtos sin corromperlos',
  mide: 'Edición segura (codificación y finales de línea)',
  categoria: 'programacion',
  pedidos: [
    'Dos cambios pequeños, y nada más. En `inventario.txt` cambia `Cantidad: 12` por `Cantidad: 15`. En `precios.txt` cambia `Precio: 4500` por `Precio: 4900` y `Stock: 7` por `Stock: 9`. Estos archivos los lee un sistema antiguo muy estricto: no puede cambiar ningún otro byte (ni codificación ni finales de línea).'
  ],
  preparar(dir) {
    writeFileSync(join(dir, 'inventario.txt'), latinBytes())
    writeFileSync(join(dir, 'precios.txt'), mixtoBytes())
  },
  verificar(dir) {
    const p = comparar(dir, 'inventario.txt', esperadoLatin()) ?? comparar(dir, 'precios.txt', esperadoMixto())
    return p ? falla(p) : ok()
  },
  guion: () => ({
    turnos: [
      [
        // Referencia segura: leer y escribir en 'latin1' (biyectivo con los bytes), así no se toca nada más.
        bash(`node -e "const f=require('fs');const e=(a,x,y)=>f.writeFileSync(a,f.readFileSync(a,'latin1').replace(x,y),'latin1');e('inventario.txt','Cantidad: 12','Cantidad: 15');e('precios.txt','Precio: 4500','Precio: 4900');e('precios.txt','Stock: 7','Stock: 9')"`, 'Edita a nivel de bytes sin cambiar codificación ni finales de línea')
      ]
    ],
    final: 'Hecho: cambié solo esos valores y los archivos conservan su codificación y sus finales de línea.'
  })
}
