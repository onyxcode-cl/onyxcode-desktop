/**
 * Ventana "assist": Teach mode (el globo que señala un elemento, sin hacer clic) y la píldora de
 * "Grabar una skill". Ninguna de las dos cabe en la píldora de control: su preload
 * (`src/preload/pill.ts`) solo tiene 3 canales y no se toca (ver plan Lote C §A.4). Esta ventana
 * tiene su propio rol (`assist`), preload (`src/preload/assist.ts`) y página
 * (`src/renderer/overlay/assist.{html,ts,css}`).
 *
 * Dos `BrowserWindow` independientes (misma página, distinta franja por el hash de la URL):
 * - `#teach`: globo 340×170 px junto al punto que señala el paso (+24, ajustado al `workArea`).
 * - `#record`: píldora 360×56 px arriba al centro, bajo la píldora de control (`overlay.ts`).
 *
 * Mismo endurecimiento que la píldora de control: sin marco, transparente, siempre encima por
 * encima incluso del overlay y la píldora (`relativeLevel: 2`), protegida contra capturas,
 * `showInactive` (nunca roba el foco) y `acceptFirstMouse` (el primer clic ya cuenta).
 */
import { BrowserWindow, screen } from 'electron'
import type { AssistMessage, SkillRecordingState, TeachStep } from '@shared/ipc-cowork'
import { extrasWindows, loadRendererPage, preloadPath } from '../extras/windows'
import { registerWindowRole } from '../ipc/guard'

const TEACH_W = 340
const TEACH_H = 170
/** Desplazamiento del globo respecto al punto señalado (esquina superior izquierda). */
const TEACH_OFFSET = 24
const RECORD_W = 360
const RECORD_H = 56
/** Debajo de la píldora de control (que mide 84 px de alto y empieza a 4 px del borde). */
const RECORD_TOP = 96

function loadAssistPage(win: BrowserWindow, hash: '#teach' | '#record'): Promise<void> {
  return loadRendererPage(win, `overlay/assist.html${hash}`)
}

export class AssistWindow {
  private teachWin: BrowserWindow | null = null
  private recordWin: BrowserWindow | null = null
  private disposed = false

  /** Muestra (o mueve) el globo de Teach junto al punto del paso. */
  showTeach(step: TeachStep): void {
    if (this.disposed) return
    const win = this.ensureTeach()
    this.positionTeach(win, step.x, step.y)
    win.showInactive()
    this.post(win, { type: 'teach', step })
  }

  /** Fin de Teach mode (el agente terminó o el usuario pulsó "Salir de la guía"). */
  clearTeach(): void {
    if (this.disposed) return
    const win = this.teachWin
    if (!win || win.isDestroyed()) return
    this.post(win, { type: 'teachClear' })
    win.hide()
  }

  /** Píldora "Grabando · N pasos · mm:ss · 🎙" (o la oculta si `state.active` es falso). */
  showRecording(state: SkillRecordingState): void {
    if (this.disposed) return
    if (!state.active) {
      const win = this.recordWin
      if (win && !win.isDestroyed()) win.hide()
      return
    }
    const win = this.ensureRecord()
    win.showInactive()
    this.post(win, { type: 'recording', state })
  }

  dispose(): void {
    this.disposed = true
    for (const w of [this.teachWin, this.recordWin]) if (w && !w.isDestroyed()) w.destroy()
    this.teachWin = null
    this.recordWin = null
  }

  // ───────────────────────────── posición ─────────────────────────────

  private positionTeach(win: BrowserWindow, x?: number, y?: number): void {
    const display =
      typeof x === 'number' && typeof y === 'number' ? screen.getDisplayNearestPoint({ x, y }) : screen.getPrimaryDisplay()
    const wa = display.workArea
    const rawLeft = typeof x === 'number' ? x + TEACH_OFFSET : wa.x + (wa.width - TEACH_W) / 2
    const rawTop = typeof y === 'number' ? y + TEACH_OFFSET : wa.y + (wa.height - TEACH_H) / 2
    const left = Math.min(Math.max(rawLeft, wa.x), wa.x + wa.width - TEACH_W)
    const top = Math.min(Math.max(rawTop, wa.y), wa.y + wa.height - TEACH_H)
    win.setBounds({ x: Math.round(left), y: Math.round(top), width: TEACH_W, height: TEACH_H })
  }

  // ───────────────────────────── ventanas ─────────────────────────────

  private ensureTeach(): BrowserWindow {
    if (this.teachWin && !this.teachWin.isDestroyed()) return this.teachWin
    const win = this.create(TEACH_W, TEACH_H)
    win.on('closed', () => {
      if (this.teachWin === win) this.teachWin = null
    })
    void loadAssistPage(win, '#teach').catch((err) => console.error('[computer] assist (teach):', err))
    this.teachWin = win
    return win
  }

  private ensureRecord(): BrowserWindow {
    if (this.recordWin && !this.recordWin.isDestroyed()) return this.recordWin
    const win = this.create(RECORD_W, RECORD_H)
    const wa = screen.getPrimaryDisplay().workArea
    win.setBounds({
      x: Math.round(wa.x + (wa.width - RECORD_W) / 2),
      y: Math.round(wa.y + RECORD_TOP),
      width: RECORD_W,
      height: RECORD_H
    })
    win.on('closed', () => {
      if (this.recordWin === win) this.recordWin = null
    })
    void loadAssistPage(win, '#record').catch((err) => console.error('[computer] assist (record):', err))
    this.recordWin = win
    return win
  }

  private create(width: number, height: number): BrowserWindow {
    const win = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: preloadPath('assist'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    })
    extrasWindows.add(win)
    registerWindowRole(win.webContents, 'assist')
    // Por encima del overlay (nivel 0) y de la píldora de control (nivel 1): el globo de Teach y
    // la píldora de grabación nunca deben quedar tapados por ellos.
    win.setAlwaysOnTop(true, 'screen-saver', 2)
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    }
    // Excluida de las capturas: el agente nunca ve su propio globo de Teach ni la píldora de grabación.
    win.setContentProtection(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    return win
  }

  private post(win: BrowserWindow, msg: AssistMessage): void {
    if (win.isDestroyed()) return
    if (win.webContents.isLoadingMainFrame()) {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send('computer:assist', msg)
      })
      return
    }
    win.webContents.send('computer:assist', msg)
  }
}
