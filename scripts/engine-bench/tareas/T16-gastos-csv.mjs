// T16 — Oficina: CSV de gastos → informe.md con totales exactos. Mide: datos.
import { contieneNumero, escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo } from './_pasos.mjs'

const CATEGORIAS = ['Transporte', 'Alimentación', 'Oficina', 'Servicios', 'Arriendo']
const DESCRIPCIONES = {
  Transporte: ['Bencina', 'Peaje', 'Estacionamiento', 'Pasajes bus'],
  Alimentación: ['Almuerzo equipo', 'Café reunión', 'Colación cliente'],
  Oficina: ['Resmas de papel', 'Tóner', 'Archivadores', 'Lápices'],
  Servicios: ['Internet', 'Electricidad', 'Agua', 'Teléfono'],
  Arriendo: ['Oficina centro', 'Bodega']
}

function filas() {
  const r = prng(1616)
  return Array.from({ length: 60 }, (_, i) => {
    const categoria = CATEGORIAS[i < 5 ? i : r.int(0, CATEGORIAS.length - 1)]
    const fecha = `2025-0${r.int(1, 6)}-${String(r.int(1, 28)).padStart(2, '0')}`
    const monto = categoria === 'Arriendo' ? r.int(300, 450) * 1000 : r.int(8, 180) * 100
    return { fecha, categoria, descripcion: r.pick(DESCRIPCIONES[categoria]), monto }
  })
}

const totales = () => {
  const t = Object.fromEntries(CATEGORIAS.map((c) => [c, 0]))
  for (const f of filas()) t[f.categoria] += f.monto
  return t
}
const sinTilde = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default {
  id: 'T16',
  nombre: 'Oficina: CSV de gastos → informe con totales exactos',
  mide: 'Datos',
  categoria: 'oficina',
  pedidos: [
    'A partir de gastos.csv (montos en pesos chilenos) escribe informe.md con una tabla de Markdown con el total gastado por categoría, ordenada de mayor a menor, y debajo una línea con el total general. Los totales tienen que ser exactos.'
  ],
  preparar(dir) {
    escribir(dir, 'gastos.csv', 'fecha,categoria,descripcion,monto\n' + filas().map((f) => `${f.fecha},${f.categoria},${f.descripcion},${f.monto}`).join('\n') + '\n')
  },
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'informe.md')
    } catch {
      return falla('no existe informe.md')
    }
    const tot = totales()
    for (const c of CATEGORIAS) if (!contieneNumero(t, tot[c])) return falla(`falta o está mal el total de ${c} (${tot[c]})`)
    const general = Object.values(tot).reduce((a, b) => a + b, 0)
    if (!contieneNumero(t, general)) return falla(`falta o está mal el total general (${general})`)
    // Orden: cada categoría aparece antes que las de menor total.
    const norm = sinTilde(t)
    const orden = [...CATEGORIAS].sort((a, b) => tot[b] - tot[a])
    const pos = orden.map((c) => norm.indexOf(sinTilde(c)))
    if (pos.some((p) => p < 0)) return falla('falta alguna categoría')
    for (let i = 1; i < pos.length; i++) if (pos[i] < pos[i - 1]) return falla('las categorías no están de mayor a menor')
    return ok()
  },
  guion: (dir) => {
    const tot = totales()
    const orden = [...CATEGORIAS].sort((a, b) => tot[b] - tot[a])
    const general = Object.values(tot).reduce((a, b) => a + b, 0)
    return {
      turnos: [
        [
          bash("head -5 gastos.csv; wc -l gastos.csv", 'Mira el CSV'),
          bash("awk -F, 'NR>1 {s[$2]+=$4} END {for (c in s) print s[c], c}' gastos.csv | sort -rn", 'Suma por categoría'),
          escribirArchivo(
            dir,
            'informe.md',
            '| Categoría | Total (CLP) |\n|---|---:|\n' + orden.map((c) => `| ${c} | ${tot[c]} |`).join('\n') + `\n\n**Total general:** ${general}\n`
          )
        ]
      ],
      final: 'Dejé el informe con los totales por categoría y el total general.'
    }
  }
}
