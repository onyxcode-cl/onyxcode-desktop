/**
 * Preferencias de computer use (`userData/computer-prefs.json`): modo de control (en segundo
 * plano / control de la pantalla) y si se ocultan las demás apps mientras el agente actúa.
 *
 * Decisión del usuario (2026-09-28, ver `docs/TASKS-LOTE-C-PLAN.md` §E): por defecto "En segundo
 * plano" y "Ocultar las demás apps" activado (`DEFAULT_COMPUTER_PREFS`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_COMPUTER_PREFS, type ComputerControlMode, type ComputerPrefs } from '@shared/ipc-tasks'

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function mode(v: unknown, fallback: ComputerControlMode): ComputerControlMode {
  return v === 'background' || v === 'full' ? v : fallback
}

/** Normaliza un objeto cualquiera a `ComputerPrefs` válidos. */
export function normalizeComputerPrefs(input: unknown, base: ComputerPrefs = DEFAULT_COMPUTER_PREFS): ComputerPrefs {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return {
    mode: mode(o.mode, base.mode),
    hideOtherApps: bool(o.hideOtherApps, base.hideOtherApps),
    unhideOnFinish: bool(o.unhideOnFinish, base.unhideOnFinish)
  }
}

export class ComputerPrefsStore {
  private cache: ComputerPrefs | null = null

  constructor(private readonly file: string) {}

  private load(): ComputerPrefs {
    if (this.cache) return this.cache
    let raw: unknown = null
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (err) {
      console.error('[computer] computer-prefs.json inválido, usando valores por defecto:', err)
    }
    this.cache = normalizeComputerPrefs(raw)
    return this.cache
  }

  get(): ComputerPrefs {
    return { ...this.load() }
  }

  set(patch: Partial<ComputerPrefs>): ComputerPrefs {
    const cur = this.load()
    const next = normalizeComputerPrefs({ ...cur, ...patch }, cur)
    this.cache = next
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, this.file)
    return this.get()
  }
}
