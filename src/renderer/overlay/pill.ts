/**
 * Píldora flotante "La IA está controlando tu Mac": paso actual + botón Detener (kill-switch
 * `computer:stop`, igual que Cmd+Shift+Escape). Arrastrable (región -webkit-app-region: drag).
 */
import type { ComputerOverlayMessage } from '@shared/ipc-cowork'
import { cowork, describeStep } from './shared'
import './pill.css'

const DEFAULT_STEP = 'Trabajando…'

const root = document.getElementById('root') as HTMLDivElement
root.innerHTML = `
  <div class="pill" role="status" aria-live="polite">
    <span class="logo" aria-hidden="true"><span class="logo-core"></span></span>
    <span class="texts">
      <span class="title">La IA está controlando tu Mac</span>
      <span class="step"></span>
    </span>
    <kbd class="hint" title="Atajo global para detener">⌘⇧Esc</kbd>
    <button type="button" class="stop">Detener</button>
  </div>
`
const pill = root.querySelector('.pill') as HTMLDivElement
const title = root.querySelector('.title') as HTMLSpanElement
const step = root.querySelector('.step') as HTMLSpanElement
const stopBtn = root.querySelector('.stop') as HTMLButtonElement

let baseStep = DEFAULT_STEP
step.textContent = baseStep

function reset(label?: string): void {
  pill.classList.remove('stopped', 'stopping')
  title.textContent = 'La IA está controlando tu Mac'
  stopBtn.disabled = false
  stopBtn.textContent = 'Detener'
  baseStep = label?.trim() || DEFAULT_STEP
  step.textContent = baseStep
}

stopBtn.addEventListener('click', () => {
  if (stopBtn.disabled) return
  stopBtn.disabled = true
  stopBtn.textContent = 'Deteniendo…'
  pill.classList.add('stopping')
  void cowork?.invoke('computer:stop').then((r) => {
    if (!r.ok) {
      stopBtn.disabled = false
      stopBtn.textContent = 'Detener'
      pill.classList.remove('stopping')
      step.textContent = `No se pudo detener: ${r.error}`
    }
  })
})

function handle(msg: ComputerOverlayMessage): void {
  switch (msg.type) {
    case 'show':
      reset(msg.label)
      document.body.classList.add('on')
      return
    case 'hide':
      document.body.classList.remove('on')
      return
    case 'stopped':
      pill.classList.remove('stopping')
      pill.classList.add('stopped')
      title.textContent = 'Control detenido'
      step.textContent = 'Has recuperado el control del Mac'
      stopBtn.disabled = true
      stopBtn.textContent = 'Detenido'
      return
    case 'action': {
      if (pill.classList.contains('stopped')) return
      const ev = msg.action
      // Las capturas automáticas tras cada acción no cambian el texto del paso.
      if (ev.tool === 'screenshot' && ev.auto) return
      if (ev.phase === 'end' && ev.ok === false) {
        step.textContent = `${describeStep(ev)} — falló`
        return
      }
      if (ev.phase !== 'end') step.textContent = describeStep(ev)
      return
    }
  }
}

cowork?.on('computer:overlay', handle)

if (location.hash === '#demo') {
  document.body.classList.add('on')
  step.textContent = 'Escribiendo “informe trimestral”'
}
