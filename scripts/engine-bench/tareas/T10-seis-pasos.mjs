// T10 — Tarea de 6 pasos con lista de tareas. Mide: plan ejecutable (ola 2).
import { escribir, falla, leer, ok } from '../lib.mjs'
import { bash, tareas } from './_pasos.mjs'

const N = Array.from({ length: 10 }, (_, i) => i + 1)
const CUADRADOS = N.map((n) => n * n)
const SUMA = CUADRADOS.reduce((a, b) => a + b, 0)
const PARES = CUADRADOS.filter((c) => c % 2 === 0)

const lineas = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

export default {
  id: 'T10',
  nombre: 'Tarea de 6 pasos con lista de tareas',
  mide: 'Plan ejecutable',
  categoria: 'programacion',
  pedidos: [
    'Haz estos 6 pasos en orden y lleva el avance con una lista de tareas: 1) crea numeros.txt con los enteros del 1 al 10, uno por línea; 2) crea cuadrados.txt con el cuadrado de cada número, en el mismo orden; 3) crea suma.txt con la suma de esos cuadrados (solo el número); 4) crea pares.txt con solo los cuadrados pares, uno por línea; 5) crea reporte.md con exactamente tres líneas: `Suma: <n>`, `Pares: <cantidad de cuadrados pares>` y `Mayor: <el cuadrado más grande>`; 6) crea LISTO.txt con la palabra `terminado`, solo si todo lo anterior es consistente.'
  ],
  preparar(dir) {
    escribir(dir, '.gitkeep', '')
  },
  verificar(dir) {
    try {
      if (lineas(leer(dir, 'numeros.txt')).join(',') !== N.join(',')) return falla('numeros.txt mal')
      if (lineas(leer(dir, 'cuadrados.txt')).join(',') !== CUADRADOS.join(',')) return falla('cuadrados.txt mal')
      if (leer(dir, 'suma.txt').trim() !== String(SUMA)) return falla('suma.txt mal')
      if (lineas(leer(dir, 'pares.txt')).join(',') !== PARES.join(',')) return falla('pares.txt mal')
      const rep = lineas(leer(dir, 'reporte.md'))
      const esperado = [`Suma: ${SUMA}`, `Pares: ${PARES.length}`, `Mayor: ${Math.max(...CUADRADOS)}`]
      if (rep.length !== 3 || rep.some((l, i) => l.replace(/^[-*]\s*/, '') !== esperado[i])) return falla(`reporte.md mal: ${rep.join(' | ')}`)
      if (leer(dir, 'LISTO.txt').trim().toLowerCase() !== 'terminado') return falla('LISTO.txt mal')
    } catch (e) {
      return falla(`falta un archivo: ${e.message.slice(0, 120)}`)
    }
    return ok()
  },
  guion: () => {
    const paso = (i, estados) =>
      tareas(['numeros', 'cuadrados', 'suma', 'pares', 'reporte', 'LISTO'].map((t, k) => [`Paso ${k + 1}: ${t}`, estados[k]]))
    const est = (n) => Array.from({ length: 6 }, (_, k) => (k < n ? 'completed' : k === n ? 'in_progress' : 'pending'))
    return {
      turnos: [
        [
          paso(0, est(0)),
          bash('seq 1 10 > numeros.txt', 'Paso 1'),
          paso(1, est(1)),
          bash("awk '{print $1*$1}' numeros.txt > cuadrados.txt", 'Paso 2'),
          paso(2, est(2)),
          bash("awk '{s+=$1} END {print s}' cuadrados.txt > suma.txt", 'Paso 3'),
          paso(3, est(3)),
          bash("awk '$1%2==0' cuadrados.txt > pares.txt", 'Paso 4'),
          paso(4, est(4)),
          bash('printf "Suma: %s\\nPares: %s\\nMayor: %s\\n" "$(cat suma.txt)" "$(wc -l < pares.txt | tr -d \' \')" "$(sort -n cuadrados.txt | tail -1)" > reporte.md', 'Paso 5'),
          paso(5, est(5)),
          bash('echo terminado > LISTO.txt', 'Paso 6'),
          paso(6, est(6))
        ]
      ],
      final: 'Los 6 pasos están hechos y consistentes.'
    }
  }
}
