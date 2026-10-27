// Registro de las 32 tareas del banco: cada archivo `Tnn-*.mjs` exporta por defecto { id, nombre, mide, categoria, pedidos, preparar,
// verificar, guion?, requiere?, mcp? } (ver README en la cabecera de `../run.mjs`).
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))

export async function cargarTareas() {
  const archivos = readdirSync(aqui).filter((n) => /^T\d\d-.*\.mjs$/.test(n)).sort()
  const tareas = []
  for (const n of archivos) tareas.push((await import(pathToFileURL(join(aqui, n)).href)).default)
  const ids = tareas.map((t) => t.id)
  if (new Set(ids).size !== ids.length) throw new Error(`ids de tarea repetidos: ${ids.join(',')}`)
  return tareas
}
