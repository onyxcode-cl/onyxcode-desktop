/**
 * Guarda: en macOS, `dialog.showMessageBox` SIN ventana padre congela el bucle de eventos de la app mientras está abierto (corre dentro de
 * `NSAlert runModal`): temporizadores, HTTP local e IPC se detienen. Con el control del Mac activo la ventana principal está minimizada, así
 * que un diálogo sin padre dejaba al agente en bucle y sin respuesta (visto en vivo con el permiso de un sitio del navegador).
 *
 * Todo diálogo que pueda salir sin ventana debe pasar por `askButtons` (`util/native-dialog.ts`). Esta prueba lee el código: cualquier
 * `showMessageBox({…})` (sin padre) o `showMessageBox(opciones)` suelto fuera de la lista de usos revisados hace fallar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src', 'main')

/** Usos revisados a mano: el motivo de cada uno. Ruta relativa a `src/main`. */
const REVIEWED: Record<string, string> = {
  'util/native-dialog.ts': 'es el sitio que decide: usa el diálogo de Electron solo de respaldo',
  'index.ts': 'confirmación de SALIR de la app: la app ya se cierra, no hay nada que congelar',
  'security/web-security.ts': 'cuadro «Acerca de», lo abre el usuario',
  'ipc/remote-handlers.ts': 'solo con ventana padre (hoja); sin ventana va por askButtons'
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

describe('diálogos que no congelan la app', () => {
  it('no hay `showMessageBox` sin ventana padre fuera de los usos revisados', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file)
      if (rel in REVIEWED) continue
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return
        if (/\bshowMessageBox(Sync)?\(/.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(
      offenders,
      `Usa askButtons (util/native-dialog.ts) o añade el archivo a REVIEWED con su motivo:\n${offenders.join('\n')}`
    ).toEqual([])
  })

  it('los usos revisados siguen existiendo (si ya no usan showMessageBox, quítalos de la lista)', () => {
    for (const rel of Object.keys(REVIEWED)) {
      expect(readFileSync(join(ROOT, rel), 'utf8')).toMatch(/showMessageBox/)
    }
  })

  it('los permisos del navegador y las peticiones del celular usan askButtons', () => {
    expect(readFileSync(join(ROOT, 'embedded-browser/approvals.ts'), 'utf8')).toContain('askButtons(')
    expect(readFileSync(join(ROOT, 'ipc/remote-handlers.ts'), 'utf8')).toContain('askButtons(')
  })
})
