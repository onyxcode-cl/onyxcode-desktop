// T13 — «Haz pasar las pruebas» (3 fallos en 3 módulos). Mide: modo objetivo (ola 3).
import { escribir, falla, leer, node, ok, sha } from '../lib.mjs'
import { bash, editar, leerArchivo } from './_pasos.mjs'

const PILA = `// Pila (último en entrar, primero en salir).
class Pila {
  constructor() {
    this.items = []
  }
  apilar(x) {
    this.items.push(x)
  }
  desapilar() {
    return this.items.shift()
  }
  cima() {
    return this.items[this.items.length - 1]
  }
  get tamano() {
    return this.items.length
  }
}
module.exports = { Pila }
`

const COLA = `// Cola (primero en entrar, primero en salir) con capacidad máxima.
class Cola {
  constructor(capacidad) {
    this.capacidad = capacidad
    this.items = []
  }
  encolar(x) {
    if (this.items.length > this.capacidad) return false
    this.items.push(x)
    return true
  }
  desencolar() {
    return this.items.shift()
  }
  get tamano() {
    return this.items.length
  }
}
module.exports = { Cola }
`

const TEXTO = `// Utilidades de texto.
function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function contarPalabras(s) {
  return s.split(' ').length
}

function esPalindromo(s) {
  const limpio = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return limpio === limpio.split('').reverse().join('')
}

module.exports = { capitalizar, contarPalabras, esPalindromo }
`

const PRUEBAS = `const assert = require('node:assert')
const { Pila } = require('./pila')
const { Cola } = require('./cola')
const t = require('./texto')

const p = new Pila()
p.apilar(1)
p.apilar(2)
p.apilar(3)
assert.strictEqual(p.desapilar(), 3)
assert.strictEqual(p.cima(), 2)
assert.strictEqual(p.tamano, 2)

const c = new Cola(2)
assert.strictEqual(c.encolar('a'), true)
assert.strictEqual(c.encolar('b'), true)
assert.strictEqual(c.encolar('c'), false)
assert.strictEqual(c.desencolar(), 'a')
assert.strictEqual(c.tamano, 1)

assert.strictEqual(t.capitalizar('hOLA'), 'Hola')
assert.strictEqual(t.contarPalabras('  uno  dos tres '), 3)
assert.strictEqual(t.contarPalabras(''), 0)
assert.strictEqual(t.esPalindromo('Anita lava la tina'), true)
assert.strictEqual(t.esPalindromo('hola'), false)
console.log('todo bien')
`

export default {
  id: 'T13',
  nombre: '«Haz pasar las pruebas» (3 fallos)',
  mide: 'Modo objetivo (ola 3)',
  categoria: 'programacion',
  pedidos: ['Haz que pasen las pruebas de este proyecto (`node pruebas.js`). No modifiques el archivo de pruebas: arregla el código.'],
  preparar(dir) {
    escribir(dir, 'pila.js', PILA)
    escribir(dir, 'cola.js', COLA)
    escribir(dir, 'texto.js', TEXTO)
    escribir(dir, 'pruebas.js', PRUEBAS)
  },
  verificar(dir) {
    if (sha(leer(dir, 'pruebas.js')) !== sha(PRUEBAS)) return falla('se modificó pruebas.js')
    const r = node(dir, 'pruebas.js')
    return r.code === 0 ? ok() : falla(`siguen fallando: ${r.out.slice(0, 220)}`)
  },
  guion: (dir) => ({
    turnos: [
      [
        bash('node pruebas.js', 'Corre las pruebas'),
        leerArchivo(dir, 'pila.js'),
        editar(dir, 'pila.js', 'return this.items.shift()', 'return this.items.pop()'),
        bash('node pruebas.js', 'Corre otra vez'),
        editar(dir, 'cola.js', 'this.items.length > this.capacidad', 'this.items.length >= this.capacidad'),
        bash('node pruebas.js', 'Corre otra vez'),
        editar(dir, 'texto.js', "return s.split(' ').length", "return s.split(/\\s+/).filter(Boolean).length"),
        bash('node pruebas.js', 'Corre otra vez')
      ]
    ],
    final: 'Arreglé los tres fallos (pila, cola y contarPalabras); las pruebas pasan.'
  })
}
