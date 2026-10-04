import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SWAPS } from './swaps'

/**
 * Un SWAP mal escrito no falla al compilar: simplemente no sustituye (y el módulo de escritorio acaba en el arranque del
 * celular), o sustituye por un shim al que le falta una exportación (y falla en silencio en tiempo de ejecución). Esta prueba
 * lo cierra: cada entrada debe existir, estar escrita EXACTAMENTE como en el importador, y el shim debe exportar todo lo que
 * ese importador usa de ese especificador.
 */
const repo = resolve(__dirname, '../../..')
const remote = resolve(__dirname)

interface Use {
  names: string[]
  def: boolean
}

/** Qué importa (valores, no tipos) el archivo `src` del especificador `spec`; `null` si no lo importa. */
function usesOf(src: string, spec: string): Use | null {
  const esc = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  let found = false
  const out: Use = { names: [], def: false }
  const re = new RegExp(`(import|export)\\s+(type\\s+)?([\\w$]+\\s*,?\\s*)?(\\{[^}]*\\})?\\s*(\\*\\s+as\\s+\\w+\\s+)?from\\s*'${esc}'`, 'g')
  for (const m of src.matchAll(re)) {
    found = true
    if (m[2]) continue // solo tipos: se borran al compilar
    if (m[3]) out.def = true
    if (m[4]) {
      for (const part of m[4].slice(1, -1).split(',')) {
        const p = part.trim()
        if (!p || p.startsWith('type ')) continue
        out.names.push(p.split(/\s+as\s+/)[0].trim())
      }
    }
  }
  if (new RegExp(`import\\(\\s*'${esc}'\\s*\\)`).test(src)) found = true
  return found ? out : null
}

function exportsOf(src: string): { names: Set<string>; def: boolean } {
  const names = new Set<string>()
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|enum)\s+([\w$]+)/g)) names.add(m[1])
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g))
    for (const part of m[1].split(',')) {
      const p = part.trim()
      if (p && !p.startsWith('type '))
        names.add(
          p
            .split(/\s+as\s+/)
            .pop()!
            .trim()
        )
    }
  return { names, def: /export\s+default\s/.test(src) }
}

const cases = Object.entries(SWAPS).flatMap(([importer, map]) => Object.entries(map).map(([spec, shim]) => ({ importer, spec, shim })))

describe('SWAPS de la PWA (pwa/vite.full.config.ts)', () => {
  it('hay entradas', () => expect(cases.length).toBeGreaterThan(10))

  it.each(cases)('$importer ← $spec → $shim', ({ importer, spec, shim }) => {
    const importerPath = resolve(repo, importer)
    expect(existsSync(importerPath), `no existe el importador ${importer}`).toBe(true)
    const shimPath = resolve(remote, shim)
    expect(existsSync(shimPath), `no existe el shim ${shim}`).toBe(true)

    const uses = usesOf(readFileSync(importerPath, 'utf8'), spec)
    expect(uses, `${importer} ya no importa «${spec}» tal cual: el SWAP no sustituiría nada`).not.toBeNull()

    const ex = exportsOf(readFileSync(shimPath, 'utf8'))
    for (const name of uses!.names) expect(ex.names.has(name), `${shim} no exporta «${name}» (lo usa ${importer})`).toBe(true)
    if (uses!.def) expect(ex.def, `${shim} no tiene export default (lo usa ${importer})`).toBe(true)
  })

  it('el especificador de un SWAP apunta a un módulo propio, no a un paquete (excepto los permitidos)', () => {
    for (const { importer, spec } of cases) {
      if (spec.startsWith('.')) {
        const base = resolve(dirname(resolve(repo, importer)), spec)
        const real = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].some((e) => existsSync(base + e))
        expect(real, `${importer}: «${spec}» no existe`).toBe(true)
      } else expect(spec).toBe('highlight.js/lib/common')
    }
  })
})
