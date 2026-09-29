/**
 * `SkillRecorder`: grabar una demostración (clic, tecla, texto, cambio de app, scroll, con
 * captura por paso y narración opcional) para convertirla en una skill reutilizable (B.8 del plan
 * Lote C). Una sola grabación a la vez, en `userData/skill-recordings/<id>/`.
 *
 * - Micrófono: `cu-helper mic-request` en un proceso APARTE antes de arrancar `record`; si falla o
 *   no se autoriza, la grabación sigue sin micro (nunca bloquea ni aborta la demostración).
 * - `stop`: SIGINT al helper, espera ≤5 s (SIGKILL de respaldo) y lee `events.jsonl`; si hubo
 *   micro, transcribe con `cu-helper transcribe` (timeout 120 s, best-effort: sin transcripción no
 *   es un error para el usuario).
 * - `prepare`: copia las capturas a `<folder>/.onyxcode/trabajo/grabaciones/<id>/` (el `root` que recibe ya
 *   viene validado por el llamador con `cowork.assertInsideApproved`), quita el texto tecleado
 *   salvo que se pida incluirlo, borra la copia de `userData` y devuelve el prompt puro de
 *   `buildRecordedSkillPrompt` (`@shared/skill-recording.ts`).
 * - Al arrancar la app, `purgeOld()` borra las grabaciones de más de 24 h (nadie las recogió).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { runHelper } from '../util/exec'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
import { EventEmitter } from 'node:events'
import { APP_ID } from '@shared/brand'
import type { RecordedStep, SkillRecording, SkillRecordingState } from '@shared/ipc-tasks'
import { buildRecordedSkillPrompt } from '@shared/skill-recording'

/** Tope del helper (`record --max-seconds`). */
export const RECORD_MAX_SECONDS = 900
/** Espera tras SIGINT antes de forzar SIGKILL. */
const STOP_WAIT_MS = 5_000
const TRANSCRIBE_TIMEOUT_MS = 120_000
const MIC_REQUEST_TIMEOUT_MS = 20_000
const HELPER_MAX_BUFFER = 8 * 1024 * 1024
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Apps que nunca deben aparecer en la propia grabación: la app y Electron sin empaquetar. */
const RECORD_EXCLUDE = `${APP_ID},com.github.Electron`

interface RecorderEvents {
  state: [SkillRecordingState]
  done: [SkillRecording]
}

export class SkillRecorder extends EventEmitter<RecorderEvents> {
  private child: ChildProcess | null = null
  private id: string | null = null
  private dir: string | null = null
  private startedAt: number | null = null
  private steps = 0
  private mic: 'off' | 'recording' | 'denied' = 'off'

  constructor(
    private readonly helperPath: () => string | null,
    private readonly baseDir: string
  ) {
    super()
  }

  state(): SkillRecordingState {
    return {
      active: !!this.child,
      id: this.id,
      startedAt: this.startedAt,
      steps: this.steps,
      mic: this.mic,
      maxSeconds: RECORD_MAX_SECONDS
    }
  }

  private emitState(): void {
    this.emit('state', this.state())
  }

  /** Borra las grabaciones de `userData/skill-recordings` de más de 24 h (llamar una vez al arrancar). */
  purgeOld(): void {
    try {
      if (!existsSync(this.baseDir)) return
      const now = Date.now()
      for (const name of readdirSync(this.baseDir)) {
        const dir = join(this.baseDir, name)
        try {
          const st = statSync(dir)
          if (st.isDirectory() && now - st.mtimeMs > MAX_AGE_MS) rmSync(dir, { recursive: true, force: true })
        } catch (err) {
          console.error('[computer] purgar grabación:', err)
        }
      }
    } catch (err) {
      console.error('[computer] purgar grabaciones:', err)
    }
  }

  /** Empieza a grabar (rechaza si ya hay una grabación en curso). */
  async start(mic: boolean): Promise<SkillRecordingState> {
    if (this.child) throw new Error('Ya hay una grabación en curso: termínala o descártala antes de empezar otra.')
    const bin = this.helperPath()
    if (!bin) throw new Error('Falta el helper nativo (cu-helper).')
    const id = randomBytes(6).toString('hex')
    const dir = join(this.baseDir, id)
    mkdirSync(dir, { recursive: true })

    let useMic = false
    let micState: 'off' | 'recording' | 'denied' = 'off'
    if (mic) {
      try {
        const out = await runHelper(bin, ['mic-request'], MIC_REQUEST_TIMEOUT_MS, HELPER_MAX_BUFFER)
        useMic = /authorized/i.test(out)
        micState = useMic ? 'recording' : 'denied'
      } catch (err) {
        console.error('[computer] mic-request:', err)
        micState = 'denied'
      }
    }

    const args = ['record', dir, '--max-seconds', String(RECORD_MAX_SECONDS), '--exclude', RECORD_EXCLUDE]
    if (useMic) args.push('--mic')
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.id = id
    this.dir = dir
    this.startedAt = Date.now()
    this.steps = 0
    this.mic = micState

    createInterface({ input: child.stdout }).on('line', (line) => {
      let ev: { event?: string; count?: number } | null = null
      try {
        ev = JSON.parse(line) as { event?: string; count?: number }
      } catch {
        return
      }
      if (ev?.event === 'step' && typeof ev.count === 'number') {
        this.steps = ev.count
        this.emitState()
      }
    })
    child.stderr?.on('data', (d: Buffer) => console.error('[computer] record:', d.toString().trim()))
    child.once('exit', () => {
      if (this.child === child) this.child = null
    })
    child.once('error', (err) => {
      console.error('[computer] record:', err)
      if (this.child === child) this.child = null
    })
    this.emitState()
    return this.state()
  }

  /** Termina (o descarta) la grabación en curso. `null` si no había ninguna. */
  async stop(discard = false): Promise<SkillRecording | null> {
    const child = this.child
    const id = this.id
    const dir = this.dir
    const startedAt = this.startedAt ?? Date.now()
    const mic = this.mic
    if (!child || !id || !dir) return null
    await this.terminate(child)
    this.child = null
    this.id = null
    this.dir = null
    this.startedAt = null
    this.steps = 0
    this.mic = 'off'
    this.emitState()
    if (discard) {
      rmSync(dir, { recursive: true, force: true })
      return null
    }
    const rec = await this.buildRecording(id, dir, Date.now() - startedAt, mic)
    try {
      writeFileSync(join(dir, 'recording.json'), JSON.stringify(rec), 'utf8')
    } catch (err) {
      console.error('[computer] recording.json:', err)
    }
    this.emit('done', rec)
    return rec
  }

  /**
   * Copia las capturas a `root/.onyxcode/trabajo/grabaciones/<id>/` (`root` ya validado por el llamador),
   * quita `text` de los pasos salvo `includeTyped`, borra la copia de `userData` y devuelve el
   * prompt (puro) para que el agente proponga la skill.
   */
  async prepare(id: string, root: string, includeTyped: boolean): Promise<{ prompt: string; relDir: string }> {
    const srcDir = join(this.baseDir, id)
    const rec = this.loadRecording(srcDir)
    if (!rec) throw new Error('No se encontró la grabación (puede haberse purgado tras 24 h).')
    // Migra la carpeta de trabajo heredada a `.onyxcode/trabajo/` antes de escribir.
    migrateFolderScratch(root, (m, e) => console.warn('[computer]', m, e ?? ''))
    const relDir = join('.onyxcode', 'trabajo', 'grabaciones', id)
    const destDir = join(root, relDir)
    mkdirSync(destDir, { recursive: true })
    for (const shot of rec.shots) {
      try {
        const from = join(srcDir, shot)
        if (existsSync(from)) copyFileSync(from, join(destDir, shot))
      } catch (err) {
        console.error('[computer] copiando captura de la grabación:', err)
      }
    }
    const steps: RecordedStep[] = includeTyped ? rec.steps : rec.steps.map((s) => (s.type === 'text' ? { ...s, text: undefined } : s))
    const prompt = buildRecordedSkillPrompt({ ...rec, steps }, { relDir, includeTyped })
    rmSync(srcDir, { recursive: true, force: true })
    return { prompt, relDir }
  }

  dispose(): void {
    if (this.child) void this.terminate(this.child)
    this.child = null
  }

  // ───────────────────────────── privado ─────────────────────────────

  private terminate(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        resolve()
      }
      child.once('exit', finish)
      try {
        child.kill('SIGINT')
      } catch {
        // el proceso ya pudo haber salido
      }
      setTimeout(() => {
        if (!done) {
          try {
            child.kill('SIGKILL')
          } catch {
            // ya no existe
          }
        }
        finish()
      }, STOP_WAIT_MS).unref()
    })
  }

  private readEvents(dir: string): RecordedStep[] {
    const file = join(dir, 'events.jsonl')
    if (!existsSync(file)) return []
    try {
      return readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Partial<RecordedStep>)
        .filter((s): s is RecordedStep => !!s && typeof s.type === 'string' && typeof s.t === 'number')
    } catch (err) {
      console.error('[computer] events.jsonl:', err)
      return []
    }
  }

  private async buildRecording(id: string, dir: string, durationMs: number, mic: 'off' | 'recording' | 'denied'): Promise<SkillRecording> {
    const steps = this.readEvents(dir)
    const shots = steps.map((s) => s.shot).filter((s): s is string => !!s)
    const micResult: SkillRecording['mic'] = mic === 'recording' ? 'recorded' : mic === 'denied' ? 'denied' : 'off'
    let transcript: string | null = null
    let transcriptError: string | undefined
    const audio = join(dir, 'audio.m4a')
    if (micResult === 'recorded' && existsSync(audio)) {
      const bin = this.helperPath()
      if (bin) {
        try {
          const out = await runHelper(bin, ['transcribe', audio], TRANSCRIBE_TIMEOUT_MS, HELPER_MAX_BUFFER)
          const j = JSON.parse(out) as { text?: unknown }
          transcript = typeof j.text === 'string' ? j.text : null
        } catch (err) {
          transcriptError = err instanceof Error ? err.message : String(err)
        }
      }
    }
    return { id, dir, startedAt: Date.now() - durationMs, durationMs, steps, shots, mic: micResult, transcript, transcriptError }
  }

  private loadRecording(dir: string): SkillRecording | null {
    const file = join(dir, 'recording.json')
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as SkillRecording
    } catch (err) {
      console.error('[computer] recording.json (lectura):', err)
      return null
    }
  }
}
