// T17 — Oficina: corregir acentos y formato de una carta en Markdown. Mide: edición de texto en español.
import { escribir, falla, leer, ok } from '../lib.mjs'
import { escribirArchivo } from './_pasos.mjs'

const CARTA = `Santiago, 12 de marzo de 2025
Estimado Sr. Gonzalez:
Por medio de la presente le informo que su solicitud de reembolso por $45.000 fue aprobada el dia 10 de marzo. El pago se realizara durante la proxima semana a traves de transferencia bancaria.
Si tiene alguna duda sobre la informacion entregada, puede comunicarse con nuestra oficina de administracion.
Atentamente, Maria Perez
Gerente de Finanzas
asunto: aprobacion de reembolso
`

const CORRECTA = `# Asunto: aprobación de reembolso

Santiago, 12 de marzo de 2025

Estimado Sr. González:

Por medio de la presente le informo que su solicitud de reembolso por $45.000 fue aprobada el día 10 de marzo. El pago se realizará durante la próxima semana a través de transferencia bancaria.

Si tiene alguna duda sobre la información entregada, puede comunicarse con nuestra oficina de administración.

Atentamente,

María Pérez
Gerente de Finanzas
`

// [mal, bien]
const PALABRAS = [
  ['Gonzalez', 'González'],
  ['dia', 'día'],
  ['realizara', 'realizará'],
  ['proxima', 'próxima'],
  ['traves', 'través'],
  ['informacion', 'información'],
  ['administracion', 'administración'],
  ['Maria', 'María'],
  ['Perez', 'Pérez'],
  ['aprobacion', 'aprobación']
]
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default {
  id: 'T17',
  nombre: 'Oficina: corregir acentos y formato de una carta',
  mide: 'Edición de texto en español',
  categoria: 'oficina',
  pedidos: [
    'Corrige las tildes y la ortografía de carta.md. Además: deja el asunto como encabezado de primer nivel al principio (`# Asunto: ...`), con la primera letra tal cual está; pon el saludo, cada párrafo, la despedida (`Atentamente,`) y la firma en líneas separadas con una línea en blanco entre bloques. No cambies nombres, montos ni fechas.'
  ],
  preparar(dir) {
    escribir(dir, 'carta.md', CARTA)
  },
  verificar(dir) {
    const t = leer(dir, 'carta.md')
    for (const [mal, bien] of PALABRAS) {
      if (new RegExp(`(?<![\\p{L}])${esc(mal)}(?![\\p{L}])`, 'u').test(t)) return falla(`queda «${mal}» sin corregir`)
      if (!t.includes(bien)) return falla(`falta «${bien}»`)
    }
    for (const dato of ['$45.000', '12 de marzo de 2025', '10 de marzo', 'Gerente de Finanzas']) if (!t.includes(dato)) return falla(`se perdió «${dato}»`)
    const lineas = t.split(/\r?\n/)
    if (!/^#\s+Asunto:\s*aprobaci[oó]n de reembolso/i.test(lineas.find((l) => l.trim()) ?? '')) return falla('el asunto no es el encabezado inicial')
    if (!lineas.some((l) => l.trim() === 'Atentamente,')) return falla('«Atentamente,» no está en su propia línea')
    if (!lineas.some((l) => l.trim() === 'María Pérez')) return falla('la firma «María Pérez» no está en su propia línea')
    if (!lineas.some((l) => /^Estimado Sr\. González:\s*$/.test(l))) return falla('el saludo no está en su propia línea')
    return /\n\s*\n/.test(t) ? ok() : falla('no hay líneas en blanco entre bloques')
  },
  guion: (dir) => ({
    turnos: [[{ name: 'read', args: { filePath: `${dir}/carta.md` } }, escribirArchivo(dir, 'carta.md', CORRECTA)]],
    final: 'Corregí las tildes y reordené la carta.'
  })
}
