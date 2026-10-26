// T19 — Sesión larga: 20 pedidos encadenados en la MISMA sesión; varios se refieren a decisiones de los pedidos 2 y 5 («el nombre que
// elegimos antes», «el separador que decidimos»). Mide: coherencia tras compactar. El verificador comprueba esas referencias en el resultado.
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash, escribirArchivo } from './_pasos.mjs'

const PEDIDOS = [
  // 1
  'Crea tienda.js (módulo CommonJS) con la función `crearProducto(sku, nombre, precio)`, que devuelve un objeto `{ sku, nombre, precio }`.',
  // 2 — decisión A: el nombre de la clase
  'Decisión de diseño: la clase que guarda los productos se llamará `Bodeguero` (con B mayúscula; no uses otro nombre). Créala en tienda.js con la propiedad `productos` (arreglo vacío al crearla) y el método `agregar(producto)`, que lo guarda y devuelve el mismo producto. Exporta `crearProducto` y `Bodeguero`.',
  // 3
  'Agrega a esa clase `buscarPorSku(sku)`: devuelve el producto o `undefined`.',
  // 4
  'Agrega `total()`: la suma de los precios de todos los productos (0 si no hay).',
  // 5 — decisión B: separador y cabecera
  'Otra decisión, esta solo para anotarla: cuando exportemos el inventario usaremos punto y coma (`;`) como separador y la primera línea será la cabecera `sku;nombre;precio`. Todavía no la implementes; escribe en DECISIONES.md un párrafo corto con esa decisión.',
  // 6
  'Agrega `eliminar(sku)`: quita el producto y devuelve `true` si existía o `false` si no.',
  // 7
  'Agrega `aplicarDescuento(porcentaje)`: devuelve un arreglo NUEVO con copias de los productos cuyo precio es `Math.round(precio * (1 - porcentaje / 100))`. No modifica los productos guardados.',
  // 8
  'Agrega `masCaro()`: devuelve el producto de mayor precio (o `undefined` si no hay productos).',
  // 9
  'Escribe prueba.js con pruebas (node:assert) de todo lo que hace la clase hasta ahora y córrela.',
  // 10
  'Agrega `ordenadosPorPrecio()`: devuelve una copia del arreglo ordenada de menor a mayor precio, sin alterar el original.',
  // 11 — usa decisión B
  'Ahora implementa la exportación según lo que decidimos antes: el método `exportar()` de la clase devuelve el texto con la cabecera y una línea por producto, en el orden en que están guardados, cada línea terminada en salto de línea.',
  // 12
  'Agrega `importar(texto)` (método estático de la misma clase) que hace lo contrario de exportar: recibe ese texto y devuelve una instancia con los productos cargados. El precio debe quedar como número.',
  // 13
  'Añade a prueba.js las pruebas de exportar e importar (que ida y vuelta dé los mismos productos) y córrela.',
  // 14 — usa decisión A y B
  'Crea cli.js: `node cli.js <archivo>` lee ese archivo con el formato que exporta nuestra clase, lo carga con la clase que elegimos al principio y escribe en pantalla una línea `Total: <número>`.',
  // 15
  'En cli.js, si además se pasa `--caro`, escribe una segunda línea `Más caro: <nombre>`.',
  // 16
  'Escribe README.md en español que explique la clase, sus métodos y el formato de exportación.',
  // 17
  'Agrega `contar()`: la cantidad de productos guardados.',
  // 18
  'Haz que `importar` ignore las líneas vacías y la cabecera aunque aparezca más de una vez.',
  // 19
  'Añade a prueba.js la prueba de esa tolerancia y de `contar()`; corre todas las pruebas.',
  // 20 — revisión de coherencia
  'Revisa todos los archivos y corrige cualquier incoherencia con las decisiones que tomamos al principio (nombre de la clase y formato de exportación), incluyendo README.md y cli.js.'
]

const VERIF = `const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const t = require('./tienda')
assert.strictEqual(typeof t.crearProducto, 'function', 'crearProducto')
assert.strictEqual(typeof t.Bodeguero, 'function', 'la clase debe llamarse Bodeguero')
assert.deepStrictEqual(t.crearProducto('A1', 'Pan', 1200), { sku: 'A1', nombre: 'Pan', precio: 1200 })
const b = new t.Bodeguero()
assert.deepStrictEqual(b.productos, [])
assert.strictEqual(b.total(), 0)
assert.strictEqual(b.masCaro(), undefined)
for (const [s, n, p] of [['A1', 'Pan', 1200], ['B2', 'Leche', 990], ['C3', 'Queso', 5400], ['D4', 'Té', 2500]]) b.agregar(t.crearProducto(s, n, p))
assert.strictEqual(b.contar(), 4)
assert.strictEqual(b.total(), 10090)
assert.strictEqual(b.buscarPorSku('C3').nombre, 'Queso')
assert.strictEqual(b.buscarPorSku('ZZ'), undefined)
assert.strictEqual(b.masCaro().sku, 'C3')
assert.deepStrictEqual(b.ordenadosPorPrecio().map((x) => x.sku), ['B2', 'A1', 'D4', 'C3'])
assert.deepStrictEqual(b.productos.map((x) => x.sku), ['A1', 'B2', 'C3', 'D4'])
const d = b.aplicarDescuento(10)
assert.deepStrictEqual(d.map((x) => x.precio), [1080, 891, 4860, 2250])
assert.strictEqual(b.buscarPorSku('A1').precio, 1200)
const texto = b.exportar()
assert.strictEqual(texto, 'sku;nombre;precio\\nA1;Pan;1200\\nB2;Leche;990\\nC3;Queso;5400\\nD4;Té;2500\\n')
const c = t.Bodeguero.importar('sku;nombre;precio\\n\\nA1;Pan;1200\\nsku;nombre;precio\\nB2;Leche;990\\n\\n')
assert.deepStrictEqual(c.productos, [{ sku: 'A1', nombre: 'Pan', precio: 1200 }, { sku: 'B2', nombre: 'Leche', precio: 990 }])
assert.deepStrictEqual(t.Bodeguero.importar(texto).productos, b.productos)
assert.strictEqual(b.eliminar('B2'), true)
assert.strictEqual(b.eliminar('B2'), false)
const f = path.join(os.tmpdir(), 'tienda-verif-' + process.pid + '.csv')
fs.writeFileSync(f, texto)
const { spawnSync } = require('node:child_process')
const r1 = spawnSync(process.execPath, ['cli.js', f], { encoding: 'utf8' })
assert.strictEqual(r1.status, 0, 'cli.js: ' + r1.stderr)
assert.ok(/^Total: 10090\\s*$/m.test(r1.stdout), 'cli.js debe escribir «Total: 10090»: ' + r1.stdout)
const r2 = spawnSync(process.execPath, ['cli.js', f, '--caro'], { encoding: 'utf8' })
assert.ok(/^Más caro: Queso\\s*$/m.test(r2.stdout), 'cli.js --caro: ' + r2.stdout)
fs.unlinkSync(f)
console.log('ok')
`

const TIENDA = `function crearProducto(sku, nombre, precio) {
  return { sku, nombre, precio }
}

class Bodeguero {
  constructor() {
    this.productos = []
  }
  agregar(producto) {
    this.productos.push(producto)
    return producto
  }
  buscarPorSku(sku) {
    return this.productos.find((p) => p.sku === sku)
  }
  total() {
    return this.productos.reduce((acc, p) => acc + p.precio, 0)
  }
  eliminar(sku) {
    const i = this.productos.findIndex((p) => p.sku === sku)
    if (i < 0) return false
    this.productos.splice(i, 1)
    return true
  }
  aplicarDescuento(porcentaje) {
    return this.productos.map((p) => ({ ...p, precio: Math.round(p.precio * (1 - porcentaje / 100)) }))
  }
  masCaro() {
    return this.productos.reduce((m, p) => (m === undefined || p.precio > m.precio ? p : m), undefined)
  }
  ordenadosPorPrecio() {
    return [...this.productos].sort((a, b) => a.precio - b.precio)
  }
  contar() {
    return this.productos.length
  }
  exportar() {
    return ['sku;nombre;precio', ...this.productos.map((p) => [p.sku, p.nombre, p.precio].join(';'))].join('\\n') + '\\n'
  }
  static importar(texto) {
    const b = new Bodeguero()
    for (const linea of texto.split(/\\r?\\n/)) {
      if (!linea.trim() || linea.trim() === 'sku;nombre;precio') continue
      const [sku, nombre, precio] = linea.split(';')
      b.agregar(crearProducto(sku, nombre, Number(precio)))
    }
    return b
  }
}

module.exports = { crearProducto, Bodeguero }
`

const CLI = `const fs = require('node:fs')
const { Bodeguero } = require('./tienda')
const [archivo, ...opciones] = process.argv.slice(2)
const b = Bodeguero.importar(fs.readFileSync(archivo, 'utf8'))
console.log('Total: ' + b.total())
if (opciones.includes('--caro')) console.log('Más caro: ' + b.masCaro().nombre)
`

const PRUEBA = `const assert = require('node:assert')
const { crearProducto, Bodeguero } = require('./tienda')
const b = new Bodeguero()
b.agregar(crearProducto('A1', 'Pan', 1200))
b.agregar(crearProducto('B2', 'Leche', 990))
assert.strictEqual(b.total(), 2190)
assert.strictEqual(b.contar(), 2)
assert.strictEqual(b.masCaro().sku, 'A1')
assert.deepStrictEqual(Bodeguero.importar(b.exportar()).productos, b.productos)
assert.strictEqual(Bodeguero.importar('sku;nombre;precio\\n\\nA1;Pan;1\\nsku;nombre;precio\\n').contar(), 1)
console.log('ok')
`

// Un solo comando por turno: el guion escribe el archivo completo con lo que ese pedido necesita (el resultado final es el mismo).
function turnos(dir) {
  const w = (ruta, texto) => escribirArchivo(dir, ruta, texto)
  const n = (ruta) => bash(`node ${ruta}`, 'Corre las pruebas')
  const vacio = []
  const t = Array.from({ length: 20 }, () => vacio)
  t[0] = [w('tienda.js', TIENDA)]
  t[4] = [w('DECISIONES.md', '# Decisiones\n\nPara exportar el inventario se usa `;` como separador y la primera línea es la cabecera `sku;nombre;precio`.\n')]
  t[8] = [w('prueba.js', PRUEBA), n('prueba.js')]
  t[12] = [n('prueba.js')]
  t[13] = [w('cli.js', CLI)]
  t[15] = [w('README.md', '# Tienda\n\nLa clase `Bodeguero` guarda productos `{ sku, nombre, precio }`. Métodos: agregar, buscarPorSku, total, eliminar, aplicarDescuento, masCaro, ordenadosPorPrecio, contar, exportar e importar.\n\nFormato de exportación: separador `;` y cabecera `sku;nombre;precio`.\n')]
  t[18] = [n('prueba.js')]
  return t.map((x) => [...x])
}

export default {
  id: 'T19',
  nombre: 'Sesión larga: 20 pedidos con referencias a decisiones',
  mide: 'Coherencia tras compactar',
  categoria: 'programacion',
  pedidos: PEDIDOS,
  presupuesto: 1_500_000,
  preparar(dir) {
    escribir(dir, '.gitkeep', '')
  },
  verificar(dir) {
    let fuente
    try {
      fuente = leer(dir, 'tienda.js')
    } catch {
      return falla('falta tienda.js')
    }
    if (!/class\s+Bodeguero\b/.test(fuente)) return falla('la clase no se llama Bodeguero')
    escribir(dir, '__verif.js', VERIF)
    const r = correr(process.execPath, ['__verif.js'], { cwd: dir })
    if (r.code !== 0) return falla(`verificación oculta: ${r.out.slice(0, 260)}`)
    const p = correr(process.execPath, ['prueba.js'], { cwd: dir })
    if (p.code !== 0) return falla(`prueba.js falla: ${p.out.slice(0, 160)}`)
    // Referencias a las decisiones: las anotadas en DECISIONES.md y el README coherente con ellas.
    let dec
    let readme
    try {
      dec = leer(dir, 'DECISIONES.md')
      readme = leer(dir, 'README.md')
    } catch {
      return falla('faltan DECISIONES.md o README.md')
    }
    if (!/sku;nombre;precio/.test(dec) || !/;/.test(dec)) return falla('DECISIONES.md no recoge la decisión del separador')
    if (!/Bodeguero/.test(readme)) return falla('README.md no nombra la clase Bodeguero')
    if (!/sku;nombre;precio/.test(readme)) return falla('README.md no documenta la cabecera sku;nombre;precio')
    if (/class\s+(?!Bodeguero\b)\w+/.test(fuente)) return falla('hay otra clase en tienda.js')
    return ok()
  },
  guion: (dir) => ({ turnos: turnos(dir), final: 'Hecho.' })
}
