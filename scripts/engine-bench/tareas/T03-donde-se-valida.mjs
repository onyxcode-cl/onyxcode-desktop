// T03 — «¿Dónde se valida X?» en un repositorio de 60 archivos (respuesta en respuesta.txt). Mide: ayudante de lectura / modelo pequeño.
import { escribir, falla, leer, ok, prng } from '../lib.mjs'
import { bash, escribirArchivo } from './_pasos.mjs'

const AREAS = ['clientes', 'pedidos', 'pagos', 'envios', 'inventario', 'reportes']
const COSAS = ['registro', 'consulta', 'resumen', 'cierre', 'cola', 'historial', 'filtros', 'permisos', 'notas', 'etiquetas']
// La validación real del formato del correo está en un solo archivo; los demás solo MENCIONAN correos.
const REAL = 'src/clientes/alta.js'

export function generar(dir) {
  const r = prng(303)
  for (const area of AREAS) {
    for (const cosa of COSAS) {
      const ruta = `src/${area}/${cosa}.js`
      if (ruta === REAL) continue
      const n = r.int(2, 5)
      const lineas = [`// ${area}/${cosa}: lógica de ${cosa} para ${area}.`]
      for (let i = 1; i <= n; i++) {
        const f = `${cosa}${i}`
        lineas.push(`function ${f}(datos) {`, `  const copia = { ...datos, paso: ${r.int(1, 99)} }`, `  if (!copia.id) throw new Error('falta id en ${area}')`, `  return copia`, `}`)
      }
      // Distractores: hablan de correo sin validar su formato.
      if (r() < 0.2) lineas.push(`function avisarPorCorreo(cliente) {`, `  return 'se enviará un correo a ' + cliente.correo`, `}`)
      lineas.push(`module.exports = { ${Array.from({ length: n }, (_, i) => `${cosa}${i + 1}`).join(', ')} }`)
      escribir(dir, ruta, lineas.join('\n') + '\n')
    }
  }
  escribir(
    dir,
    REAL,
    `// Alta de clientes.
const REGEX_CORREO = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/

function altaCliente(datos) {
  if (!datos.nombre) throw new Error('falta nombre')
  if (!REGEX_CORREO.test(datos.correo || '')) throw new Error('correo con formato inválido')
  return { ...datos, activo: true }
}

module.exports = { altaCliente }
`
  )
}

export default {
  id: 'T03',
  nombre: '«¿Dónde se valida X?» en un repo de 60 archivos',
  mide: 'Ayudante de lectura, modelo pequeño',
  categoria: 'programacion',
  pedidos: [
    'En este proyecto, ¿en qué archivo se valida que el correo de un cliente tenga un formato válido? Escribe solo la ruta de ese archivo (relativa a esta carpeta) en respuesta.txt.'
  ],
  preparar: generar,
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'respuesta.txt').trim()
    } catch {
      return falla('no existe respuesta.txt')
    }
    const limpia = t.replace(/^\.\//, '').replace(/^`|`$/g, '')
    return limpia === REAL ? ok() : falla(`respuesta equivocada: «${t.slice(0, 80)}»`)
  },
  guion: (dir) => ({
    turnos: [[bash('grep -rn "correo" src | head -30', 'Busca dónde se habla de correo'), bash('grep -rn "REGEX_CORREO\\|test(" src', 'Busca la validación'), escribirArchivo(dir, 'respuesta.txt', REAL + '\n')]],
    final: `La validación del correo está en ${REAL}.`
  })
}
