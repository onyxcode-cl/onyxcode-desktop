/**
 * Página de la ventana "assist": el globo de Teach mode (`#teach`) y la píldora de "Grabar una
 * skill" (`#record`). Qué se muestra lo decide el hash de la URL: son dos `BrowserWindow`
 * independientes que cargan la misma página (ver `main/computer/assist-window.ts`).
 */
import '../src/lib/page-lang'
import { t } from '@shared/i18n'
import type { AssistMessage, SkillRecordingState, TeachStep } from '@shared/ipc-tasks'
import { tasks } from './shared'
import './assist.css'

const root = document.getElementById('root') as HTMLDivElement
const mode: 'teach' | 'record' = location.hash === '#record' ? 'record' : 'teach'
document.title = t('ovl.assist.title')
document.body.classList.add(mode)

if (mode === 'teach') initTeach(root)
else initRecord(root)

// ───────────────────────────── Teach mode ─────────────────────────────

function initTeach(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="teach" role="status" aria-live="polite">
      <div class="teach-head">
        <span class="teach-badge"></span>
      </div>
      <p class="teach-title"></p>
      <p class="teach-text"></p>
      <div class="teach-actions">
        <button type="button" class="teach-exit">${t('ovl.teach.exit')}</button>
        <button type="button" class="teach-next">${t('ovl.teach.next')}</button>
      </div>
    </div>
  `
  const badge = root.querySelector('.teach-badge') as HTMLSpanElement
  const title = root.querySelector('.teach-title') as HTMLParagraphElement
  const text = root.querySelector('.teach-text') as HTMLParagraphElement
  const next = root.querySelector('.teach-next') as HTMLButtonElement
  const exit = root.querySelector('.teach-exit') as HTMLButtonElement

  let current: TeachStep | null = null
  let busy = false

  function setBusy(v: boolean): void {
    busy = v
    next.disabled = v
    exit.disabled = v
  }

  function render(step: TeachStep): void {
    current = step
    badge.textContent = step.step && step.total ? t('ovl.teach.step', { step: step.step, total: step.total }) : t('ovl.teach.badge')
    title.textContent = step.title ?? t('ovl.teach.defaultTitle')
    title.hidden = !step.title
    text.textContent = step.text
    setBusy(false)
    document.body.classList.add('on')
  }

  function clear(): void {
    document.body.classList.remove('on')
    current = null
  }

  async function respond(action: 'next' | 'exit'): Promise<void> {
    const step = current
    if (!step || busy) return
    setBusy(true)
    await tasks?.invoke('computer:teachRespond', { id: step.id, action })
    if (action === 'exit') clear()
  }

  next.addEventListener('click', () => void respond('next'))
  exit.addEventListener('click', () => void respond('exit'))

  tasks?.on('computer:assist', (payload) => {
    const msg = payload as AssistMessage
    if (msg.type === 'teach') render(msg.step)
    else if (msg.type === 'teachClear' || msg.type === 'hide') clear()
  })
}

// ───────────────────────────── Grabar una skill ─────────────────────────────

function initRecord(root: HTMLDivElement): void {
  root.innerHTML = `
    <div class="record" role="status" aria-live="polite">
      <span class="record-dot" aria-hidden="true"></span>
      <span class="record-text"></span>
      <button type="button" class="record-discard">${t('ovl.record.discard')}</button>
      <button type="button" class="record-finish">${t('ovl.record.finish')}</button>
    </div>
  `
  const text = root.querySelector('.record-text') as HTMLSpanElement
  const finish = root.querySelector('.record-finish') as HTMLButtonElement
  const discard = root.querySelector('.record-discard') as HTMLButtonElement

  let busy = false
  let last: SkillRecordingState | null = null
  let ticker: ReturnType<typeof setInterval> | null = null

  function pad(n: number): string {
    return String(Math.max(0, n)).padStart(2, '0')
  }

  function render(state: SkillRecordingState): void {
    const elapsedS = state.startedAt ? Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000)) : 0
    const mic = state.mic === 'recording' ? ' · 🎙' : state.mic === 'denied' ? t('ovl.record.noMic') : ''
    text.textContent = t('ovl.record.recording', {
      count: state.steps,
      time: `${pad(Math.floor(elapsedS / 60))}:${pad(elapsedS % 60)}`,
      mic
    })
  }

  function setBusy(v: boolean): void {
    busy = v
    finish.disabled = v
    discard.disabled = v
  }

  async function stop(discardIt: boolean): Promise<void> {
    if (busy) return
    setBusy(true)
    await tasks?.invoke('computer:record:stop', { discard: discardIt })
    setBusy(false)
  }

  finish.addEventListener('click', () => void stop(false))
  discard.addEventListener('click', () => void stop(true))

  tasks?.on('computer:assist', (payload) => {
    const msg = payload as AssistMessage
    if (msg.type === 'recording') {
      last = msg.state
      if (msg.state.active) {
        document.body.classList.add('on')
        render(msg.state)
        if (!ticker) ticker = setInterval(() => last && render(last), 1000)
      } else {
        document.body.classList.remove('on')
        if (ticker) {
          clearInterval(ticker)
          ticker = null
        }
      }
    } else if (msg.type === 'hide') {
      document.body.classList.remove('on')
    }
  })
}
