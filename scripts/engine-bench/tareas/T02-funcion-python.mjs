// T02 — Añadir una función y su prueba (Python). Mide: plan corto.
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash } from './_pasos.mjs'

const UTIL = `"""Utilidades numéricas pequeñas."""


def promedio(valores):
    if not valores:
        raise ValueError("lista vacía")
    return sum(valores) / len(valores)


def mediana(valores):
    if not valores:
        raise ValueError("lista vacía")
    orden = sorted(valores)
    m = len(orden) // 2
    return orden[m] if len(orden) % 2 else (orden[m - 1] + orden[m]) / 2


def porcentaje(parte, total):
    if total == 0:
        raise ValueError("el total no puede ser cero")
    return parte * 100 / total
`

const TEST = `import unittest

import utilidades as u


class PruebasUtilidades(unittest.TestCase):
    def test_promedio(self):
        self.assertEqual(u.promedio([2, 4, 6]), 4)

    def test_mediana_par(self):
        self.assertEqual(u.mediana([1, 2, 3, 4]), 2.5)

    def test_porcentaje(self):
        self.assertEqual(u.porcentaje(25, 200), 12.5)


if __name__ == "__main__":
    unittest.main()
`

const VERIF = `import utilidades as u

assert abs(u.promedio_ponderado([1, 2, 3], [1, 1, 2]) - 2.25) < 1e-9
assert u.promedio_ponderado([10], [5]) == 10
for malos in (([1], [1, 2]), ([1, 2], [0, 0])):
    try:
        u.promedio_ponderado(*malos)
    except ValueError:
        continue
    raise SystemExit("faltó ValueError con %r" % (malos,))
print("ok")
`

export default {
  id: 'T02',
  nombre: 'Añadir función + prueba (Python)',
  mide: 'Plan corto',
  categoria: 'programacion',
  requiere: ['python3'],
  pedidos: [
    'Agrega a utilidades.py la función `promedio_ponderado(valores, pesos)`: devuelve el promedio ponderado y lanza ValueError si las listas tienen distinto largo o si la suma de los pesos es cero. Escribe también sus pruebas en test_utilidades.py, en el mismo estilo que las que ya hay.'
  ],
  preparar(dir) {
    escribir(dir, 'utilidades.py', UTIL)
    escribir(dir, 'test_utilidades.py', TEST)
  },
  verificar(dir) {
    const t = correr('python3', ['-m', 'unittest', 'test_utilidades'], { cwd: dir })
    if (t.code !== 0) return falla(`unittest falla: ${t.out.slice(-200)}`)
    const usos = (leer(dir, 'test_utilidades.py').match(/promedio_ponderado\(/g) ?? []).length
    if (usos < 3) return falla(`pocas pruebas de promedio_ponderado (${usos} usos)`)
    escribir(dir, '__verif.py', VERIF)
    const v = correr('python3', ['__verif.py'], { cwd: dir })
    return v.code === 0 ? ok() : falla(`verificación oculta: ${v.out.slice(-200)}`)
  },
  guion: (dir) => ({
    turnos: [
      [
        bash(`cat >> utilidades.py <<'EOF'


def promedio_ponderado(valores, pesos):
    if len(valores) != len(pesos):
        raise ValueError("valores y pesos deben tener el mismo largo")
    suma = sum(pesos)
    if suma == 0:
        raise ValueError("la suma de los pesos no puede ser cero")
    return sum(v * p for v, p in zip(valores, pesos)) / suma
EOF`, 'Agrega la función'),
        bash(`python3 - <<'EOF'
p = "test_utilidades.py"
s = open(p, encoding="utf-8").read()
nuevo = '''    def test_promedio_ponderado(self):
        self.assertAlmostEqual(u.promedio_ponderado([1, 2, 3], [1, 1, 2]), 2.25)

    def test_promedio_ponderado_largos_distintos(self):
        with self.assertRaises(ValueError):
            u.promedio_ponderado([1], [1, 2])

    def test_promedio_ponderado_pesos_cero(self):
        with self.assertRaises(ValueError):
            u.promedio_ponderado([1, 2], [0, 0])


if __name__'''
s = s.replace("\\n\\nif __name__", "\\n" + nuevo, 1)
open(p, "w", encoding="utf-8").write(s)
EOF`, 'Agrega las pruebas'),
        bash('python3 -m unittest test_utilidades', 'Corre las pruebas')
      ]
    ],
    final: 'Agregué promedio_ponderado y tres pruebas; todo pasa.'
  })
}
