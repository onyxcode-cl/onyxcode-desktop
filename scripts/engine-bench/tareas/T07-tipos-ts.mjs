// T07 — Arreglar errores de tipos (TypeScript). Mide: LSP (ola 4). Necesita el compilador `tsc`: `--typescript <carpeta de typescript>`
// (o BENCH_TYPESCRIPT); sin él la tarea se OMITE (no cuenta como fallo). La carpeta se enlaza como node_modules/typescript.
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash, editar } from './_pasos.mjs'

const INVENTARIO = `export interface Producto {
  id: number
  nombre: string
  precio: number
  stock: number
}

export function crearProducto(id: number, nombre: string, precio: number): Producto {
  return { id, nombre, precio }
}

export function buscar(productos: Producto[], id: number): Producto {
  return productos.find((p) => p.id === id)
}

export function totalInventario(productos: Producto[]): number {
  let total = 0
  for (const p of productos) total += p.precio * p.stock
  return total
}
`

const MAIN = `import { buscar, crearProducto, totalInventario } from './inventario'

const lista = [crearProducto(1, 'Mate', '2500'), crearProducto(2, 'Bombilla', 1800)]
const mate = buscar(lista, 1).nombre
console.log(mate, totalInventario(lista))
`

export default {
  id: 'T07',
  nombre: 'Arreglar error de tipos (TS)',
  mide: 'LSP (ola 4)',
  categoria: 'programacion',
  requiere: ['typescript'],
  pedidos: [
    'El proyecto no pasa la revisión de tipos: `npm run tipos` muestra errores. Corrígelos bien (sin `any`, sin `as` forzados y sin `@ts-ignore`) y deja que `npm run tipos` termine sin errores.'
  ],
  preparar(dir, ctx) {
    escribir(dir, 'inventario.ts', INVENTARIO)
    escribir(dir, 'main.ts', MAIN)
    escribir(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'commonjs', noEmit: true, types: [] }, include: ['*.ts'] }, null, 2) + '\n')
    escribir(dir, 'package.json', JSON.stringify({ name: 'inventario', private: true, scripts: { tipos: 'tsc --noEmit -p .' } }, null, 2) + '\n')
    mkdirSync(join(dir, 'node_modules', '.bin'), { recursive: true })
    symlinkSync(ctx.typescript, join(dir, 'node_modules', 'typescript'))
    symlinkSync('../typescript/bin/tsc', join(dir, 'node_modules', '.bin', 'tsc'))
  },
  verificar(dir) {
    const r = correr(process.execPath, [join(dir, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', '.'], { cwd: dir, timeoutMs: 90_000 })
    if (r.code !== 0) return falla(`tsc sigue con errores: ${r.out.slice(0, 240)}`)
    const fuente = leer(dir, 'inventario.ts') + leer(dir, 'main.ts')
    if (/@ts-ignore|@ts-nocheck|: any\b|<any>|as any|as unknown/.test(fuente)) return falla('usa any/@ts-ignore/as unknown')
    if (!/stock/.test(leer(dir, 'inventario.ts'))) return falla('se quitó el campo stock')
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [
        bash('npm run tipos', 'Ve los errores de tipos'),
        editar(dir, 'inventario.ts', '  return { id, nombre, precio }', '  return { id, nombre, precio, stock: 0 }'),
        editar(dir, 'inventario.ts', 'id: number): Producto {\n  return productos', 'id: number): Producto | undefined {\n  return productos'),
        editar(dir, 'main.ts', "'Mate', '2500'", "'Mate', 2500"),
        editar(dir, 'main.ts', 'buscar(lista, 1).nombre', 'buscar(lista, 1)?.nombre'),
        bash('npm run tipos', 'Revisa los tipos otra vez')
      ]
    ],
    final: 'Corregí los tres errores de tipos; npm run tipos termina sin errores.'
  })
}
