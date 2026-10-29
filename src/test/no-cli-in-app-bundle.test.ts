/**
 * Los módulos de línea de comandos de las Tareas (`chat-*-cli.ts`) se ejecutan SOLOS al importarse cuando `require.main === module`, y en la app
 * empaquetada el archivo principal de Electron cumple esa condición: importarlos desde el código de la app hace que Lazunox imprima «Uso: build_chat_…»
 * y se cierre al arrancar (visto en una prueba real en Windows). Solo los scripts de empaquetado (`scripts/`) y sus propias pruebas pueden importarlos.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = /chat-(?:deck|docx|xlsx|doc)-cli/
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

describe('la app no importa las líneas de comandos de las Tareas', () => {
  it('ningún archivo de src/ (salvo ellas mismas y sus pruebas) las importa', () => {
    const offenders: string[] = []
    for (const f of walk(join(process.cwd(), 'src'))) {
      if (/chat-(?:deck|docx|xlsx|doc)-cli(?:\.test)?\.ts$/.test(f) || /no-cli-in-app-bundle\.test\.ts$/.test(f)) continue
      const text = readFileSync(f, 'utf8')
      for (const line of text.split('\n')) {
        if (/^\s*(?:import|export)\b.*from\s+['"]/.test(line) && CLI.test(line)) offenders.push(`${f}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
