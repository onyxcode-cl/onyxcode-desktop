// T12 — Usar un conector MCP de prueba con 40 herramientas (`mcp-bench.mjs`). Mide: búsqueda diferida y topes MCP.
// El conector se registra como «almacen» (herramientas `almacen_*`); el ejecutor lo añade a la configuración del motor (`mcp: true`).
import { falla, leer, ok } from '../lib.mjs'
import { escribirArchivo } from './_pasos.mjs'
import { stockDe } from '../mcp-bench.mjs'

const SKUS = ['SKU-1001', 'SKU-1007', 'SKU-1013']

export default {
  id: 'T12',
  nombre: 'Usar un conector MCP de prueba con 40 herramientas',
  mide: 'Búsqueda diferida, topes MCP',
  categoria: 'programacion',
  mcp: true,
  pedidos: [
    `Con el conector de almacén consulta el stock de ${SKUS.join(', ')} y escribe en stock.txt una línea por producto con el formato \`SKU-xxxx: cantidad\` (solo el número de unidades).`
  ],
  preparar() {},
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'stock.txt')
    } catch {
      return falla('no existe stock.txt')
    }
    for (const sku of SKUS) {
      const m = t.match(new RegExp(`${sku}\\s*[:=-]\\s*(\\d+)`))
      if (!m) return falla(`falta la línea de ${sku}`)
      if (Number(m[1]) !== stockDe(sku)) return falla(`${sku}: dijo ${m[1]} y es ${stockDe(sku)}`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        ...SKUS.map((sku) => ({ name: 'almacen_consultar_stock', args: { sku } })),
        escribirArchivo(dir, 'stock.txt', SKUS.map((s) => `${s}: ${stockDe(s)}`).join('\n') + '\n')
      ]
    ],
    final: 'Consulté el stock de los tres productos y lo dejé en stock.txt.'
  })
}
