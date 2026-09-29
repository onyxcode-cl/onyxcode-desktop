/**
 * Ocultar las demás apps mientras el agente controla la pantalla (`ComputerPrefs.hideOtherApps`),
 * vía los comandos nuevos del helper (`hide-apps` / `unhide-apps`, B.1 del plan Lote C). Persiste
 * qué se ocultó en `userData/computer-hidden.json` para poder recuperarlas si la app se cierra a
 * mitad (crash, ⌘Q): se comprueba una vez al arrancar (`recoverAtStartup`).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runHelper } from '../util/exec'

interface HiddenFile {
  hidden: string[]
  at: number
}

export class AppVisibility {
  constructor(
    private readonly helperPath: () => string | null,
    private readonly file: string
  ) {}

  /**
   * Oculta toda app normal que no esté en `keep` (bundle ids: apps con concesión, las exentas del
   * sistema y Finder). Persiste la lista realmente ocultada por el helper (best-effort: si falla,
   * no oculta nada y no persiste).
   */
  async hide(keep: Iterable<string>): Promise<void> {
    const bin = this.helperPath()
    if (!bin) return
    const keepCsv = [...new Set(keep)].filter(Boolean).join(',')
    try {
      const out = JSON.parse(await runHelper(bin, ['hide-apps', keepCsv])) as { hidden?: unknown }
      const hidden = Array.isArray(out.hidden) ? out.hidden.filter((h): h is string => typeof h === 'string') : []
      this.persist(hidden)
    } catch (err) {
      console.error('[computer] hide-apps:', err)
    }
  }

  /** Vuelve a mostrar lo que se ocultó (si algo hay pendiente) y borra el archivo de recuperación. */
  async unhide(): Promise<void> {
    const hidden = this.load()
    this.clear()
    if (!hidden.length) return
    const bin = this.helperPath()
    if (!bin) return
    try {
      await runHelper(bin, ['unhide-apps', hidden.join(',')])
    } catch (err) {
      console.error('[computer] unhide-apps:', err)
    }
  }

  /** Al arrancar la app: si quedó un archivo de una sesión anterior que no cerró bien, restaura esas apps. */
  async recoverAtStartup(): Promise<void> {
    if (!existsSync(this.file)) return
    await this.unhide()
  }

  private persist(hidden: string[]): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const data: HiddenFile = { hidden, at: Date.now() }
      writeFileSync(this.file, JSON.stringify(data), 'utf8')
    } catch (err) {
      console.error('[computer] computer-hidden.json (escritura):', err)
    }
  }

  private load(): string[] {
    try {
      if (!existsSync(this.file)) return []
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<HiddenFile>
      return Array.isArray(raw.hidden) ? raw.hidden.filter((h): h is string => typeof h === 'string') : []
    } catch (err) {
      console.error('[computer] computer-hidden.json (lectura):', err)
      return []
    }
  }

  private clear(): void {
    rmSync(this.file, { force: true })
  }
}
