// T20 — Oficina: editar frases que contienen «», “” y — (raya) en una carta y un informe. Mide: edición tolerante (el modelo suele
// reescribir esos signos como "..." o - y el texto buscado ya no coincide). El verificador exige el texto final EXACTO.
import { escribir, falla, leer, ok } from '../lib.mjs'
import { editar, leerArchivo } from './_pasos.mjs'

const CARTA = `Valparaíso, 3 de abril de 2025

Estimada señora Núñez:

Le escribimos por su pedido n.º 4471. Como acordamos, la condición «Entrega inmediata» figura en el contrato, aunque la cláusula 7 —según la cual el despacho depende del stock— puede retrasarla.

El valor total, IVA incluido, es de $128.500. Si “todo sale bien”, el envío saldrá el lunes; de lo contrario, le avisaremos por correo.

Quedamos atentos a su respuesta.

Cordialmente,
Equipo de Atención — Tienda Andina
`

const INFORME = `# Informe trimestral — Tienda Andina

Resumen: las ventas —netas de devoluciones— crecieron un 12 % respecto de “enero”, y el «margen operativo» se mantuvo estable.

## Contacto

Responsable: Ana Pérez — Finanzas
Revisión: Luis Muñoz — Auditoría interna

## Notas

El indicador “margen operativo” se calcula sobre ventas netas; la cifra «provisoria» se reemplazará al cierre.
`

// [archivo, antes, después] — cada «antes» aparece UNA vez en su archivo.
const CAMBIOS = [
  ['carta.md', '«Entrega inmediata»', '«Entrega en 48 horas»'],
  ['carta.md', 'Si “todo sale bien”,', 'Si “todo sale como se espera”,'],
  ['carta.md', 'Equipo de Atención — Tienda Andina', 'Equipo de Atención al Cliente — Tienda Andina'],
  ['informe.md', 'crecieron un 12 % respecto de “enero”', 'crecieron un 8 % respecto de “enero”'],
  ['informe.md', 'Responsable: Ana Pérez — Finanzas', 'Responsable: Ana Pérez — Contabilidad'],
  ['informe.md', 'la cifra «provisoria» se reemplazará', 'la cifra «definitiva» se publicará']
]

const aplicar = (archivo, texto) => CAMBIOS.filter((c) => c[0] === archivo).reduce((t, [, a, d]) => t.replace(a, d), texto)

export default {
  id: 'T20',
  nombre: 'Oficina: editar frases con «», “” y —',
  mide: 'Edición tolerante (comillas y rayas)',
  categoria: 'oficina',
  pedidos: [
    'Haz estos seis cambios y nada más; conserva tal cual las comillas («», “”) y las rayas (— y –), las tildes y el resto del texto de ambos archivos.\n' +
      'En carta.md: (1) cambia «Entrega inmediata» por «Entrega en 48 horas» (manteniendo las comillas angulares); (2) cambia Si “todo sale bien”, por Si “todo sale como se espera”, ; (3) la firma "Equipo de Atención — Tienda Andina" pasa a "Equipo de Atención al Cliente — Tienda Andina".\n' +
      'En informe.md: (4) el 12 % pasa a 8 % (queda «crecieron un 8 % respecto de “enero”»); (5) en Contacto, "Ana Pérez — Finanzas" pasa a "Ana Pérez — Contabilidad"; (6) en Notas, la frase «provisoria» pasa a «definitiva» y "se reemplazará al cierre" pasa a "se publicará al cierre".'
  ],
  preparar(dir) {
    escribir(dir, 'carta.md', CARTA)
    escribir(dir, 'informe.md', INFORME)
  },
  verificar(dir) {
    for (const [archivo, original] of [['carta.md', CARTA], ['informe.md', INFORME]]) {
      let t
      try {
        t = leer(dir, archivo).replace(/\r\n/g, '\n')
      } catch {
        return falla(`falta ${archivo}`)
      }
      const esperado = aplicar(archivo, original)
      if (t === esperado) continue
      // Diagnóstico: primera línea distinta.
      const a = t.split('\n')
      const e = esperado.split('\n')
      for (let i = 0; i < Math.max(a.length, e.length); i++) if (a[i] !== e[i]) return falla(`${archivo} línea ${i + 1}: «${(a[i] ?? '').slice(0, 90)}» ≠ «${(e[i] ?? '').slice(0, 90)}»`)
      return falla(`${archivo} no coincide con lo esperado`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        leerArchivo(dir, 'carta.md'),
        leerArchivo(dir, 'informe.md'),
        ...CAMBIOS.map(([archivo, antes, despues]) => editar(dir, archivo, antes, despues))
      ]
    ],
    final: 'Hice los seis cambios conservando las comillas y las rayas.'
  })
}
