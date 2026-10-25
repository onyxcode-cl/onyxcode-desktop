// Constructores de pasos para los guiones del proveedor falso (`--proveedor-falso`). Las herramientas y sus argumentos son las reales del motor.
import { join } from 'node:path'

export const leerArchivo = (dir, ruta) => ({ name: 'read', args: { filePath: join(dir, ruta) } })
export const editar = (dir, ruta, antes, despues, todo = false) => ({
  name: 'edit',
  args: { filePath: join(dir, ruta), oldString: antes, newString: despues, ...(todo ? { replaceAll: true } : {}) }
})
export const escribirArchivo = (dir, ruta, contenido) => ({ name: 'write', args: { filePath: join(dir, ruta), content: contenido } })
export const bash = (command, description = 'Ejecuta un comando') => ({ name: 'bash', args: { command, description } })
export const buscar = (pattern, path, include) => ({ name: 'grep', args: { pattern, ...(path ? { path } : {}), ...(include ? { include } : {}) } })
export const tareas = (items) => ({
  name: 'todowrite',
  args: { todos: items.map(([content, status]) => ({ content, status, priority: 'medium' })) }
})
