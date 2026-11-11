/** C2 (revisión final 1.8.19): el texto de «Permitir…» de la tarjeta de conectores dice exactamente a qué aplica y cuánto dura. */
import { describe, expect, it } from 'vitest'
import { es } from './es'
import { en } from './en'

describe('«Permitir mientras esta carpeta siga abierta»', () => {
  it('dice que vale para esa herramienta con cualquier dato, para toda la carpeta y hasta detener su tarea; nunca «en esta tarea»', () => {
    expect(es['tasks.connector.allowTask']).not.toMatch(/en esta tarea/i)
    expect(es['tasks.connector.taskHint']).toMatch(/cualquier dato/)
    expect(es['tasks.connector.taskHint']).toMatch(/todas las conversaciones de esta carpeta/)
    expect(es['tasks.connector.taskHint']).toMatch(/hasta que se detenga su tarea/)
    expect(en['tasks.connector.taskHint']).toMatch(/any data/)
    expect(en['tasks.connector.taskHint']).toMatch(/every conversation in this folder/)
  })
})
