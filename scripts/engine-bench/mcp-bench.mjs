// Conector MCP de prueba del banco (tarea T12): servidor stdio SIN dependencias con 40 herramientas de «almacén» de descripción y
// esquema realistas (como las de un conector de verdad). Solo una sirve para la tarea (`consultar_stock`); las otras 39 pesan en la
// lista de herramientas, que es lo que mide la tarea (búsqueda diferida, topes MCP). Determinista: el stock sale del número del SKU.
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

/** Stock «real» de un SKU (lo comparte el verificador de T12). */
export const stockDe = (sku) => {
  const n = Number(String(sku).replace(/\D/g, '')) || 0
  return ((n * 37) % 97) + 3
}

const VERBOS = ['crear', 'actualizar', 'eliminar', 'listar', 'buscar', 'exportar', 'archivar', 'asignar']
const OBJETOS = ['orden_compra', 'proveedor', 'bodega', 'etiqueta', 'lote', 'devolucion', 'ubicacion', 'inventario_fisico', 'transferencia', 'alerta']
const ESCRITURA = new Set(['crear', 'actualizar', 'eliminar', 'archivar', 'asignar'])

const decorativa = (i) => {
  const verbo = VERBOS[i % VERBOS.length]
  const objeto = OBJETOS[Math.floor(i / VERBOS.length) % OBJETOS.length]
  return {
    name: `${verbo}_${objeto}`,
    description:
      `${verbo[0].toUpperCase()}${verbo.slice(1)} ${objeto.replace(/_/g, ' ')} en el sistema de almacén; devuelve su identificador, estado y enlace. ` +
      `Úsala cuando la persona pida ${verbo} ${objeto.replace(/_/g, ' ')} o lo nombre por número. Las fechas van en ISO 8601 (UTC). ` +
      `Los resultados se paginan: pasa el cursor anterior para continuar. Los errores vuelven como texto con un código estable ` +
      `(NO_ENCONTRADO, SIN_PERMISO, LIMITE). Esta operación ${ESCRITURA.has(verbo) ? 'escribe: confirma antes con la persona' : 'es de solo lectura y se puede repetir'}.`,
    inputSchema: {
      type: 'object',
      properties: {
        bodega: { type: 'string', description: 'Identificador de la bodega, p. ej. "central-santiago".' },
        titulo: { type: 'string', description: `Título corto de ${objeto.replace(/_/g, ' ')}.`, maxLength: 200 },
        detalle: { type: 'string', description: 'Descripción en Markdown.' },
        estado: { type: 'string', enum: ['abierto', 'en_curso', 'bloqueado', 'cerrado'], description: 'Estado del flujo.' },
        responsable: { type: 'string', description: 'Usuario o correo.' },
        vence: { type: 'string', description: 'Fecha límite, ISO 8601.' },
        limite: { type: 'number', description: 'Máximo de elementos (1-100).' },
        cursor: { type: 'string', description: 'Cursor de paginación.' }
      },
      required: ['bodega']
    }
  }
}

export const HERRAMIENTAS = [
  {
    name: 'consultar_stock',
    description:
      'Consulta cuántas unidades hay en stock de un producto del almacén central. Recibe el SKU (por ejemplo SKU-1001) y devuelve ' +
      'una línea "SKU-xxxx: N unidades". Es de solo lectura y se puede repetir.',
    inputSchema: { type: 'object', properties: { sku: { type: 'string', description: 'Código del producto, formato SKU-1234.' } }, required: ['sku'] }
  },
  ...Array.from({ length: 39 }, (_, i) => decorativa(i))
]

function servir() {
  const enviar = (m) => process.stdout.write(JSON.stringify(m) + '\n')
  const texto = (t) => ({ content: [{ type: 'text', text: t }] })
  createInterface({ input: process.stdin }).on('line', (linea) => {
    let m
    try {
      m = JSON.parse(linea)
    } catch {
      return
    }
    if (m.id === undefined) return // notificaciones
    if (m.method === 'initialize')
      return enviar({
        jsonrpc: '2.0',
        id: m.id,
        result: { protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'almacen-bench', version: '1.0.0' } }
      })
    if (m.method === 'tools/list') return enviar({ jsonrpc: '2.0', id: m.id, result: { tools: HERRAMIENTAS } })
    if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params ?? {}
      if (name === 'consultar_stock') return enviar({ jsonrpc: '2.0', id: m.id, result: texto(`${a?.sku}: ${stockDe(a?.sku)} unidades`) })
      return enviar({ jsonrpc: '2.0', id: m.id, result: texto(`${name}: operación simulada sin efecto`) })
    }
    if (m.method === 'ping') return enviar({ jsonrpc: '2.0', id: m.id, result: {} })
    enviar({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'método no soportado' } })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) servir()
