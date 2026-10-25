// T08 — Resumir 3 módulos con 3 ayudantes en paralelo. Mide: ayudantes y resultado acotado.
import { escribir, falla, leer, ok } from '../lib.mjs'
import { escribirArchivo, leerArchivo } from './_pasos.mjs'

const MODULOS = {
  auth: ['iniciarSesion', 'cerrarSesion', 'renovarToken', 'verificarPermiso'],
  pagos: ['cobrar', 'reembolsar', 'conciliar', 'listarMovimientos'],
  reportes: ['ventasPorMes', 'topClientes', 'exportarCsv', 'resumenAnual']
}

const DOCS = {
  iniciarSesion: 'Valida usuario y clave y abre una sesión nueva.',
  cerrarSesion: 'Invalida la sesión activa y limpia sus galletas.',
  renovarToken: 'Cambia un token por otro nuevo antes de que venza.',
  verificarPermiso: 'Dice si el usuario puede hacer una acción sobre un recurso.',
  cobrar: 'Cobra un monto a un medio de pago y devuelve el comprobante.',
  reembolsar: 'Devuelve total o parcialmente un cobro ya hecho.',
  conciliar: 'Cruza los cobros del día con el extracto del banco.',
  listarMovimientos: 'Lista los movimientos de una cuenta entre dos fechas.',
  ventasPorMes: 'Suma las ventas de cada mes de un año.',
  topClientes: 'Devuelve los clientes que más compraron en un período.',
  exportarCsv: 'Convierte un reporte en texto CSV listo para descargar.',
  resumenAnual: 'Arma el resumen del año con totales y variaciones.'
}

const fuente = (nombre) =>
  `// Módulo ${nombre}.\n` +
  MODULOS[nombre]
    .map((f, i) => `\n/** ${DOCS[f]} */\nfunction ${f}(entrada) {\n  const pasos = ${i + 2}\n  return { ok: true, pasos, entrada }\n}\n`)
    .join('') +
  `\nmodule.exports = { ${MODULOS[nombre].join(', ')} }\n`

export default {
  id: 'T08',
  nombre: 'Resumir 3 módulos con 3 ayudantes en paralelo',
  mide: 'Ayudantes, resultado acotado',
  categoria: 'programacion',
  pedidos: [
    'Resume los tres módulos de `src/` (auth.js, pagos.js y reportes.js). Si puedes, usa un ayudante por módulo en paralelo. Junta los resúmenes en resumen.md con una sección por módulo que nombre cada función que exporta y diga para qué sirve.'
  ],
  preparar(dir) {
    for (const m of Object.keys(MODULOS)) escribir(dir, `src/${m}.js`, fuente(m))
  },
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'resumen.md')
    } catch {
      return falla('no existe resumen.md')
    }
    const faltan = Object.values(MODULOS).flat().filter((f) => !t.includes(f))
    if (faltan.length) return falla(`faltan funciones en el resumen: ${faltan.join(', ')}`)
    for (const m of Object.keys(MODULOS)) if (!new RegExp(m, 'i').test(t)) return falla(`no nombra el módulo ${m}`)
    return t.length >= 300 ? ok() : falla('resumen demasiado corto')
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'src/auth.js'),
        leerArchivo(dir, 'src/pagos.js'),
        leerArchivo(dir, 'src/reportes.js'),
        escribirArchivo(
          dir,
          'resumen.md',
          '# Resumen de módulos\n\n' +
            Object.entries(MODULOS)
              .map(([m, fs]) => `## ${m}\n\n${fs.map((f) => `- \`${f}\`: ${DOCS[f]}`).join('\n')}\n`)
              .join('\n')
        )
      ]
    ],
    final: 'Resumí los tres módulos en resumen.md.'
  })
}
