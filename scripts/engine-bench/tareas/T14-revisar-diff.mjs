// T14 — Revisar un diff con un bug sembrado. Mide: revisor (ola 3).
import { escribir, falla, leer, ok } from '../lib.mjs'
import { escribirArchivo } from './_pasos.mjs'

const PAGINAR_NUEVO = `// Paginación de listas.
// Devuelve la página \`pagina\` (desde 1) con \`porPagina\` elementos.
function paginar(lista, pagina, porPagina) {
  if (pagina < 1) throw new Error('la página empieza en 1')
  const inicio = (pagina - 1) * porPagina
  const fin = inicio + porPagina
  return lista.slice(inicio, fin + 1)
}

function totalPaginas(lista, porPagina) {
  return Math.ceil(lista.length / porPagina)
}

module.exports = { paginar, totalPaginas }
`
const LINEA_BUG = PAGINAR_NUEVO.split('\n').findIndex((l) => l.includes('fin + 1')) + 1

const FORMATO_NUEVO = `// Formato de textos.
const sufijo = '...'

function recortar(texto, max) {
  return texto.length > max ? texto.slice(0, max - sufijo.length) + sufijo : texto
}

module.exports = { recortar }
`

const DIFF = `diff --git a/paginar.js b/paginar.js
--- a/paginar.js
+++ b/paginar.js
@@ -1,12 +1,14 @@
-function paginar(lista, pagina, porPagina) {
-  const inicio = pagina * porPagina
-  return lista.slice(inicio, inicio + porPagina)
-}
+// Paginación de listas.
+// Devuelve la página \`pagina\` (desde 1) con \`porPagina\` elementos.
+function paginar(lista, pagina, porPagina) {
+  if (pagina < 1) throw new Error('la página empieza en 1')
+  const inicio = (pagina - 1) * porPagina
+  const fin = inicio + porPagina
+  return lista.slice(inicio, fin + 1)
+}

 function totalPaginas(lista, porPagina) {
   return Math.ceil(lista.length / porPagina)
 }

 module.exports = { paginar, totalPaginas }
diff --git a/formato.js b/formato.js
--- a/formato.js
+++ b/formato.js
@@ -1,5 +1,6 @@
-function recortar(texto, max) {
-  return texto.length > max ? texto.slice(0, max - 3) + '...' : texto
-}
+// Formato de textos.
+const sufijo = '...'
+
+function recortar(texto, max) {
+  return texto.length > max ? texto.slice(0, max - sufijo.length) + sufijo : texto
+}
 module.exports = { recortar }
`

export default {
  id: 'T14',
  nombre: 'Revisar un diff con un bug sembrado',
  mide: 'Revisor (ola 3)',
  categoria: 'programacion',
  pedidos: [
    'Revisa el cambio de cambio.diff como lo haría una persona que revisa código. Escribe en revision.md solo los problemas reales que introduce (di el archivo y la línea de cada uno); no comentes estilo ni gustos.'
  ],
  preparar(dir) {
    escribir(dir, 'paginar.js', PAGINAR_NUEVO)
    escribir(dir, 'formato.js', FORMATO_NUEVO)
    escribir(dir, 'cambio.diff', DIFF)
  },
  verificar(dir) {
    let t
    try {
      t = leer(dir, 'revision.md')
    } catch {
      return falla('no existe revision.md')
    }
    if (!/paginar/i.test(t)) return falla('no menciona paginar.js')
    const linea = new RegExp(`(?:l[ií]nea|line|L|:)\\s*${LINEA_BUG}\\b`, 'i').test(t) || /fin\s*\+\s*1/.test(t)
    if (!linea) return falla(`no señala la línea ${LINEA_BUG} ni la expresión «fin + 1»`)
    const dice = /de m[aá]s|extra|off.by.one|uno m[aá]s|sobra|\+\s*1|una m[aá]s|excede/i.test(t)
    return dice ? ok() : falla('no explica que devuelve un elemento de más')
  },
  guion: (dir) => ({
    turnos: [
      [
        { name: 'read', args: { filePath: `${dir}/cambio.diff` } },
        escribirArchivo(dir, 'revision.md', `# Revisión\n\n- **paginar.js:${LINEA_BUG}**: \`lista.slice(inicio, fin + 1)\` devuelve un elemento de más por página (error de uno: \`fin\` ya es exclusivo).\n`)
      ]
    ],
    final: 'Encontré un error de uno en paginar.js.'
  })
}
