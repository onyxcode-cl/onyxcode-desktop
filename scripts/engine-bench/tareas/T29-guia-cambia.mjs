// T29 — Sesión larga (6 pedidos) en la que AGENTS.md cambia a mitad: el pedido 3 corre un guion que reescribe la guía (el prefijo de las funciones
// exportadas pasa de `lz_` a `lzx_`). Los módulos de los pedidos 4-6 deben seguir la guía NUEVA; los de los pedidos 1-2 la antigua. Mide: avisos de
// diferencias de instrucciones (7.9). El pedido 3 no pide releer la guía; un motor que no avisa del cambio deja al modelo con la regla vieja.
import { correr, escribir, falla, leer, ok } from '../lib.mjs'
import { bash, escribirArchivo, leerArchivo } from './_pasos.mjs'

const GUIA_1 = `# Guía del proyecto

## Convenciones de código
- Cada módulo vive en \`src/<nombre>.js\` y usa CommonJS (\`module.exports\`).
- Toda función exportada lleva el prefijo \`lz_\` (por ejemplo \`lz_sumar\`); el módulo no exporta nada más.
- Sin dependencias externas.
`
const GUIA_2 = `# Guía del proyecto

## Convenciones de código (revisión 2)
- Cada módulo vive en \`src/<nombre>.js\` y usa CommonJS (\`module.exports\`).
- Toda función exportada lleva el prefijo \`lzx_\` (por ejemplo \`lzx_sumar\`); el módulo no exporta nada más. El prefijo \`lz_\` quedó en desuso.
- Sin dependencias externas.
`
const ACTUALIZAR = `#!/bin/sh
# Aplica la revisión 2 de la guía acordada por el equipo.
cat > AGENTS.md <<'EOF2'
${GUIA_2}EOF2
echo "guía actualizada"
`

// nombre → [descripción del pedido, función con su nombre sin prefijo, cuerpo, prueba]
const MODULOS = [
  { n: 'sumar', pedido: 'una función que sume una lista de números', cuerpo: 'xs.reduce((a, b) => a + b, 0)', prueba: '[[1, 2, 3]]', espera: 6 },
  { n: 'maximo', pedido: 'una función que devuelva el mayor de una lista de números', cuerpo: 'Math.max(...xs)', prueba: '[[4, 9, 2]]', espera: 9 },
  { n: 'promedio', pedido: 'una función que calcule el promedio de una lista de números', cuerpo: 'xs.reduce((a, b) => a + b, 0) / xs.length', prueba: '[[2, 4, 6]]', espera: 4 },
  { n: 'minimo', pedido: 'una función que devuelva el menor de una lista de números', cuerpo: 'Math.min(...xs)', prueba: '[[4, 9, 2]]', espera: 2 },
  { n: 'contar', pedido: 'una función que cuente cuántos elementos tiene una lista', cuerpo: 'xs.length', prueba: '[[7, 7, 7, 7]]', espera: 4 }
]
const prefijoDe = (i) => (i < 2 ? 'lz_' : 'lzx_')
const modulo = (m, i) => `// Módulo ${m.n}\nconst ${prefijoDe(i)}${m.n} = (xs) => ${m.cuerpo}\nmodule.exports = { ${prefijoDe(i)}${m.n} }\n`

export default {
  id: 'T29',
  nombre: 'La guía AGENTS.md cambia en mitad de una sesión larga',
  mide: 'Avisos de diferencias de instrucciones',
  categoria: 'programacion',
  pedidos: [
    `Siguiendo la guía del proyecto (AGENTS.md), crea el módulo \`${MODULOS[0].n}\` con ${MODULOS[0].pedido}.`,
    `Siguiendo la guía, crea el módulo \`${MODULOS[1].n}\` con ${MODULOS[1].pedido}.`,
    'El equipo acordó una revisión de la guía: corre `sh actualizar-guia.sh`, que la aplica.',
    `Ahora crea el módulo \`${MODULOS[2].n}\` con ${MODULOS[2].pedido}, siguiendo la guía.`,
    `Crea también el módulo \`${MODULOS[3].n}\` con ${MODULOS[3].pedido}.`,
    `Y por último el módulo \`${MODULOS[4].n}\` con ${MODULOS[4].pedido}.`
  ],
  preparar(dir) {
    escribir(dir, 'AGENTS.md', GUIA_1)
    escribir(dir, 'actualizar-guia.sh', ACTUALIZAR)
  },
  verificar(dir) {
    let guia
    try {
      guia = leer(dir, 'AGENTS.md')
    } catch {
      return falla('desapareció AGENTS.md')
    }
    if (guia !== GUIA_2) return falla('AGENTS.md no quedó en la revisión 2 (¿no se corrió actualizar-guia.sh?)')
    for (const [i, m] of MODULOS.entries()) {
      const ruta = `src/${m.n}.js`
      const prefijo = prefijoDe(i)
      const r = correr(process.execPath, ['-e', `let mod;try{mod=require('./${ruta}')}catch(e){console.log('no carga: '+e.message.split('\\n')[0]);process.exit(1)};const k=Object.keys(mod);if(k.length!==1||k[0]!=='${prefijo}${m.n}'){console.log('exporta '+JSON.stringify(k)+', se esperaba ${prefijo}${m.n}');process.exit(1)};if(mod[k[0]](...${m.prueba})!==${m.espera}){console.log('resultado incorrecto');process.exit(1)}`], { cwd: dir })
      if (r.code !== 0) return falla(`${ruta} (${i < 2 ? 'antes' : 'después'} del cambio de guía): ${r.out.trim().slice(0, 140)}`)
    }
    return ok()
  },
  guion: (dir) => ({
    turnos: [
      [leerArchivo(dir, 'AGENTS.md'), escribirArchivo(dir, 'src/sumar.js', modulo(MODULOS[0], 0))],
      [escribirArchivo(dir, 'src/maximo.js', modulo(MODULOS[1], 1))],
      [bash('sh actualizar-guia.sh', 'Aplica la revisión 2 de la guía'), leerArchivo(dir, 'AGENTS.md')],
      [escribirArchivo(dir, 'src/promedio.js', modulo(MODULOS[2], 2))],
      [escribirArchivo(dir, 'src/minimo.js', modulo(MODULOS[3], 3))],
      [escribirArchivo(dir, 'src/contar.js', modulo(MODULOS[4], 4))]
    ],
    final: 'Listo.'
  })
}
