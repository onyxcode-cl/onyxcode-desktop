// T24 — Leer 8 archivos pequeños y resumirlos. Mide: lecturas en paralelo (7.3). El verificador solo mira el resultado (un resumen con el folio y
// el responsable de cada archivo); el paralelismo se ve en las métricas `pasos` y `llamadas/paso` del informe (8 lecturas en 1-2 pasos frente a 8).
import { escribir, falla, leer, ok, prng } from '../lib.mjs'
import { leerArchivo, escribirArchivo } from './_pasos.mjs'

const TEMAS = ['compras de papel', 'mantención del ascensor', 'licencias de software', 'arriendo de bodega', 'capacitación de seguridad', 'cambio de proveedor de café', 'reparación del techo', 'auditoría de inventario']
const NOMBRES = ['Camila Rojas', 'Tomás Vera', 'Ignacia Soto', 'Matías Pino', 'Javiera Mena', 'Felipe Lagos', 'Daniela Ortiz', 'Nicolás Cea']

function datos() {
  const r = prng(2401)
  const usados = new Set()
  return TEMAS.map((tema, i) => {
    let folio
    do folio = r.int(10000, 99999)
    while (usados.has(folio))
    usados.add(folio)
    return { archivo: `acta-${i + 1}.txt`, tema, folio, responsable: NOMBRES[i], monto: r.int(20, 900) * 1000 }
  })
}

const texto = (d) =>
  `ACTA INTERNA\nTema: ${d.tema}\nFolio: ${d.folio}\nResponsable: ${d.responsable}\nMonto aprobado: ${d.monto} pesos\nEstado: pendiente de firma\n`

export default {
  id: 'T24',
  nombre: 'Leer 8 archivos pequeños y resumirlos',
  mide: 'Lecturas en paralelo (pasos y llamadas por paso)',
  categoria: 'oficina',
  pedidos: [
    'En la carpeta `actas/` hay 8 actas internas (`acta-1.txt` a `acta-8.txt`). Léelas todas y escribe `resumen.md` con una línea por acta con este formato: `acta-N.txt | tema | folio | responsable | monto`.'
  ],
  preparar(dir) {
    for (const d of datos()) escribir(dir, `actas/${d.archivo}`, texto(d))
  },
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'resumen.md')
    } catch {
      return falla('no existe resumen.md')
    }
    const lineas = t.split('\n')
    for (const d of datos()) {
      const l = lineas.find((x) => x.includes(d.archivo))
      if (!l) return falla(`falta la línea de ${d.archivo}`)
      if (!l.includes(String(d.folio))) return falla(`${d.archivo}: falta el folio ${d.folio}`)
      if (!l.includes(d.responsable)) return falla(`${d.archivo}: falta el responsable ${d.responsable}`)
      const montos = [String(d.monto), String(d.monto).replace(/\B(?=(\d{3})+(?!\d))/g, '.'), String(d.monto).replace(/\B(?=(\d{3})+(?!\d))/g, ',')]
      if (!montos.some((m) => l.includes(m))) return falla(`${d.archivo}: falta el monto ${d.monto}`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        // Un modelo bueno pide las ocho lecturas en una sola respuesta; el guion las emite en paralelo.
        { paralelo: datos().map((d) => leerArchivo(dir, `actas/${d.archivo}`)) },
        escribirArchivo(dir, 'resumen.md', datos().map((d) => `${d.archivo} | ${d.tema} | ${d.folio} | ${d.responsable} | ${d.monto}`).join('\n') + '\n')
      ]
    ],
    final: 'Leí las ocho actas y dejé el resumen en resumen.md.'
  })
}
