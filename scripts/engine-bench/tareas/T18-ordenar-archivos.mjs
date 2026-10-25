// T18 — Oficina: ordenar 30 archivos en carpetas por fecha. Mide: shell con cuidado (no perder ni cambiar nada).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { escribir, falla, ok, prng } from '../lib.mjs'
import { bash } from './_pasos.mjs'

function archivos() {
  const r = prng(1818)
  const usados = new Set()
  const lista = []
  while (lista.length < 30) {
    const mes = r.int(1, 6)
    const dia = r.int(1, 28)
    const clave = `${mes}-${dia}`
    if (usados.has(clave)) continue
    usados.add(clave)
    const fecha = `2024-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
    const nombre = `${r.pick(['informe', 'acta', 'factura', 'nota'])}-${fecha}.txt`
    lista.push({ nombre, anio: '2024', mes: String(mes).padStart(2, '0'), contenido: `Documento ${nombre}\nCódigo ${r.int(100000, 999999)}\n` })
  }
  return lista
}

export default {
  id: 'T18',
  nombre: 'Oficina: ordenar 30 archivos en carpetas por fecha',
  mide: 'Shell con cuidado',
  categoria: 'oficina',
  pedidos: [
    'En entrada/ hay 30 documentos cuyo nombre termina con la fecha (nombre-AAAA-MM-DD.txt). Muévelos a ordenados/AAAA/MM/ según esa fecha (por ejemplo ordenados/2024/03/). No borres ni cambies el contenido de ninguno y no dejes nada en entrada/.'
  ],
  preparar(dir) {
    for (const a of archivos()) escribir(dir, `entrada/${a.nombre}`, a.contenido)
  },
  verificar(dir) {
    for (const a of archivos()) {
      const destino = join(dir, 'ordenados', a.anio, a.mes, a.nombre)
      if (!existsSync(destino)) return falla(`falta ordenados/${a.anio}/${a.mes}/${a.nombre}`)
      if (readFileSync(destino, 'utf8') !== a.contenido) return falla(`cambió el contenido de ${a.nombre}`)
    }
    const quedan = existsSync(join(dir, 'entrada')) ? readdirSync(join(dir, 'entrada')).filter((n) => n.endsWith('.txt')) : []
    return quedan.length ? falla(`quedan ${quedan.length} archivos en entrada/`) : ok()
  },
  guion: () => ({
    turnos: [
      [
        bash('ls entrada | head -40; ls entrada | wc -l', 'Mira los archivos'),
        bash(
          'for f in entrada/*.txt; do b=$(basename "$f"); y=$(echo "$b" | sed -E \'s/.*-([0-9]{4})-([0-9]{2})-[0-9]{2}\\.txt/\\1/\'); m=$(echo "$b" | sed -E \'s/.*-([0-9]{4})-([0-9]{2})-[0-9]{2}\\.txt/\\2/\'); mkdir -p "ordenados/$y/$m"; mv "$f" "ordenados/$y/$m/"; done; ls ordenados/*/* | head -50',
          'Mueve cada archivo a su carpeta'
        )
      ]
    ],
    final: 'Moví los 30 documentos a ordenados/AAAA/MM/.'
  })
}
