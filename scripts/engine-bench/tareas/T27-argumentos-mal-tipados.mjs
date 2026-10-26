// T27 — El modelo manda argumentos con el tipo equivocado: un arreglo/objeto como texto JSON (`todos`), un número como cadena (`timeout`, `offset`,
// `limit`), un booleano como cadena (`replaceAll: "true"`) y `null` en un opcional (`replaceAll: null`). Mide: reparación de la entrada (7.13).
// SOLO con el proveedor falso (`requiere: ['proveedor-falso']`): un modelo real no se induce a equivocarse así de forma fiable. El guion NO reintenta
// con los tipos correctos: si el motor rechaza la entrada, el cambio no se hace y el verificador falla; si la repara, pasa. La autoprueba aplica
// los `args` (los valores con los tipos correctos).
import { escribir, falla, leer, ok } from '../lib.mjs'

import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG = 'modo=prueba\nnivel=bajo\nmodo-extra=prueba\nregion=sur\n'
const CONFIG_FINAL = 'modo=produccion\nnivel=alto\nmodo-extra=produccion\nregion=sur\n'
const TODOS = [['Cambiar el modo', 'in_progress'], ['Subir el nivel', 'pending']].map(([content, status]) => ({ content, status, priority: 'medium' }))

export default {
  id: 'T27',
  nombre: 'Argumentos de herramientas mal tipados',
  mide: 'Reparación de la entrada (objeto como texto, número como cadena, null)',
  categoria: 'programacion',
  requiere: ['proveedor-falso'],
  pedidos: [
    'En `config.txt` cambia todas las apariciones de `prueba` por `produccion` y `nivel=bajo` por `nivel=alto`; crea `hecho.txt` con la palabra `listo` (con un `echo`), y apunta tus pasos en la lista de tareas.'
  ],
  preparar(dir) {
    escribir(dir, 'config.txt', CONFIG)
  },
  verificar(dir, _ctx, extra) {
    let t
    try {
      t = leer(dir, 'config.txt')
    } catch {
      return falla('no existe config.txt')
    }
    if (t !== CONFIG_FINAL) return falla(`config.txt quedó distinto de lo esperado: ${JSON.stringify(t).slice(0, 120)}`)
    if (!existsSync(join(dir, 'hecho.txt')) || leer(dir, 'hecho.txt').trim() !== 'listo') return falla('falta hecho.txt con «listo» (bash con timeout como cadena)')
    // En el banco real también se exige que ninguna herramienta haya devuelto error (con la entrada reparada, no hay rechazos).
    if (extra && extra.erroresHerramientas > 0) return falla(`${extra.erroresHerramientas} llamada(s) a herramientas devolvieron error`)
    return ok()
  },
  guion: (dir) => {
    const f = join(dir, 'config.txt')
    return {
      turnos: [
        [
          // objeto/arreglo como texto
          { name: 'todowrite', args: { todos: TODOS }, crudo: { todos: JSON.stringify(TODOS) } },
          // null por un opcional
          { name: 'edit', args: { filePath: f, oldString: 'nivel=bajo', newString: 'nivel=alto' }, crudo: { filePath: f, oldString: 'nivel=bajo', newString: 'nivel=alto', replaceAll: null } },
          // booleano como cadena: debe cambiar las dos apariciones
          { name: 'edit', args: { filePath: f, oldString: 'prueba', newString: 'produccion', replaceAll: true }, crudo: { filePath: f, oldString: 'prueba', newString: 'produccion', replaceAll: 'true' } },
          // número como cadena
          { name: 'bash', args: { command: 'echo listo > hecho.txt', description: 'Crea hecho.txt' }, crudo: { command: 'echo listo > hecho.txt', description: 'Crea hecho.txt', timeout: '20000' } },
          { name: 'read', args: { filePath: f, offset: 1, limit: 10 }, crudo: { filePath: f, offset: '1', limit: '10' }, sinEfecto: true }
        ]
      ],
      final: 'Hecho: config.txt actualizado, hecho.txt creado y la lista de tareas al día.'
    }
  }
}
