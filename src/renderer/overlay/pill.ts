/**
 * Píldora flotante "La IA está controlando tu Mac": paso actual + botón Detener (kill-switch
 * `computer:stop`, igual que Cmd+Shift+Escape). Arrastrable (región -webkit-app-region: drag).
 *
 * También es el lugar PRIMARIO donde se responde una tarjeta `request_access` (plan inicial de la
 * tarea, o una app extra a mitad de tarea): mientras está pendiente, la sesión queda en pausa SIN
 * LÍMITE DE TIEMPO (no hay "sin respuesta ⇒ denegado") y la píldora se agranda para mostrar el
 * plan y un selector de nivel por app. Aprobar/Denegar desde aquí NUNCA activa la ventana
 * principal de Lapis (`showInactive`, ver `computer/overlay.ts`); "Editar en Lapis" es la única
 * acción que la trae al frente, y solo porque el usuario la pulsó.
 *
 * Nunca escala ni baja permisos en silencio: se preselecciona `defaultAccessDecision` (lo que declara
 * el agente, sin bajar de lo ya concedido); ✕, Esc y "Cancelar" envían `cancel` (no tocan ninguna
 * concesión) y solo el "Denegar" explícito por app (o "Denegar todo" en tarjetas sin plan) deniega.
 */
import {
  APP_TIER_RANK,
  TIER_LABEL_ES,
  defaultAccessDecision,
  type AccessDecision,
  type AccessRequest,
  type AccessRequestApp,
  type ComputerOverlayMessage
} from '@shared/ipc-cowork'
import { cowork, describeStep } from './shared'
import './pill.css'

const DEFAULT_STEP = 'Trabajando…'
const TIERS: Array<{ v: AccessDecision; label: string }> = [
  { v: 'view', label: 'Ver' },
  { v: 'click', label: 'Clic' },
  { v: 'full', label: 'Total' },
  { v: 'deny', label: 'Denegar' }
]

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
  <div class="request" hidden>
    <div class="request-head">
      <span class="request-title"></span>
      <button type="button" class="req-close" title="Cancelar (no cambia ningún permiso)">✕</button>
    </div>
    <p class="request-reason"></p>
    <ol class="request-plan"></ol>
    <p class="request-note request-noapps" hidden>Este plan no controla ninguna app: usará la terminal, archivos o la web.</p>
    <p class="request-note request-unresolved" hidden></p>
    <ul class="request-apps"></ul>
    <div class="request-actions">
      <button type="button" class="req-deny">Denegar todo</button>
      <button type="button" class="req-edit">Editar en Lapis</button>
      <button type="button" class="req-approve">Aprobar y empezar</button>
    </div>
    <p class="request-error"></p>
  </div>
`
const pill = root.querySelector('.pill') as HTMLDivElement
const title = root.querySelector('.title') as HTMLSpanElement
const step = root.querySelector('.step') as HTMLSpanElement
const stopBtn = root.querySelector('.stop') as HTMLButtonElement
const request = root.querySelector('.request') as HTMLDivElement
const reqTitle = root.querySelector('.request-title') as HTMLSpanElement
const reqReason = root.querySelector('.request-reason') as HTMLParagraphElement
const reqPlan = root.querySelector('.request-plan') as HTMLOListElement
const reqApps = root.querySelector('.request-apps') as HTMLUListElement
const reqNoApps = root.querySelector('.request-noapps') as HTMLParagraphElement
const reqUnresolved = root.querySelector('.request-unresolved') as HTMLParagraphElement
const reqApprove = root.querySelector('.req-approve') as HTMLButtonElement
const reqDeny = root.querySelector('.req-deny') as HTMLButtonElement
const reqEdit = root.querySelector('.req-edit') as HTMLButtonElement
const reqClose = root.querySelector('.req-close') as HTMLButtonElement
const reqError = root.querySelector('.request-error') as HTMLParagraphElement

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

// ───────────────────────────── tarjeta "Plan y permisos" / request_access ─────────────────────────────

let activeRequest: AccessRequest | null = null
let choices: Record<string, AccessDecision> = {}
let busy = false

/** Línea informativa de una app: "Pide: X · Ahora: Y · Denegada antes" (+ aviso si la elección queda por debajo de lo concedido). */
function renderMeta(app: AccessRequestApp, meta: HTMLElement): void {
  const parts = [`Pide: ${TIER_LABEL_ES[app.requested ?? 'click']}`]
  if (app.current) parts.push(`Ahora: ${TIER_LABEL_ES[app.current]}`)
  if (app.denied) parts.push('Denegada antes')
  const choice = choices[app.bundleId]
  // Aprobar nunca baja un nivel ya concedido (main aplica el máximo): se avisa si la elección queda por debajo.
  if (app.current && choice && choice !== 'deny' && APP_TIER_RANK[choice] < APP_TIER_RANK[app.current]) {
    parts.push(`Se mantiene ${TIER_LABEL_ES[app.current]} (bajar: Ajustes)`)
  }
  meta.textContent = parts.join(' · ')
}

function renderTierButtons(app: AccessRequestApp, meta: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div')
  wrap.className = 'req-tiers'
  const requested = app.requested ?? 'click'
  for (const t of TIERS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = t.label
    btn.className = `req-tier req-tier-${t.v}`
    btn.classList.toggle('active', choices[app.bundleId] === t.v)
    btn.classList.toggle('requested', t.v === requested)
    btn.addEventListener('click', () => {
      choices[app.bundleId] = t.v
      wrap.querySelectorAll('.req-tier').forEach((b, i) => b.classList.toggle('active', TIERS[i]?.v === t.v))
      renderMeta(app, meta)
    })
    wrap.appendChild(btn)
  }
  return wrap
}

function renderRequest(req: AccessRequest): void {
  activeRequest = req
  choices = Object.fromEntries(req.apps.map((a) => [a.bundleId, defaultAccessDecision(a)]))
  request.classList.toggle('takeover', req.kind === 'takeover')
  // Tarjeta "¿Tomar el control de la pantalla?" (request_full_control): sin plan, sin selector de
  // nivel por app (siempre "full" implícito), solo dos botones binarios.
  if (req.kind === 'takeover') {
    reqTitle.textContent = '¿Tomar el control de la pantalla?'
    reqReason.textContent = `El agente trabajaba en ${req.apps[0]?.name ?? 'una app'} en segundo plano y necesita el ratón y el teclado.`
    reqReason.hidden = false
    reqPlan.innerHTML = ''
    reqPlan.hidden = true
    reqNoApps.hidden = true
    reqUnresolved.textContent = ''
    reqUnresolved.hidden = true
    reqApps.innerHTML = ''
    reqApps.hidden = true
    reqDeny.textContent = 'Seguir en segundo plano'
    reqDeny.hidden = false
    reqApprove.textContent = 'Permitir'
    reqError.textContent = ''
    setBusy(false)
    request.hidden = false
    pill.hidden = true
    return
  }
  const hasApps = req.apps.length > 0
  reqTitle.textContent = req.plan
    ? hasApps
      ? 'Plan y permisos'
      : 'Plan de la tarea'
    : req.apps.length === 1
      ? `¿Permitir usar ${req.apps[0]?.name}?`
      : '¿Permitir usar estas apps?'
  reqReason.textContent = req.reason ?? ''
  reqReason.hidden = !req.reason
  reqPlan.innerHTML = ''
  if (req.plan?.length) {
    for (const planStep of req.plan) {
      const li = document.createElement('li')
      li.textContent = planStep
      reqPlan.appendChild(li)
    }
  }
  reqPlan.hidden = !req.plan?.length
  reqNoApps.hidden = hasApps
  reqUnresolved.textContent = req.unresolved?.length ? `No encontré: ${req.unresolved.join(', ')}` : ''
  reqUnresolved.hidden = !req.unresolved?.length
  reqApps.innerHTML = ''
  reqApps.hidden = !hasApps
  for (const a of req.apps) {
    const li = document.createElement('li')
    li.className = 'req-app'
    const name = document.createElement('span')
    name.className = 'req-app-name'
    name.textContent = a.name
    const meta = document.createElement('span')
    meta.className = 'req-app-meta'
    renderMeta(a, meta)
    li.appendChild(name)
    li.appendChild(renderTierButtons(a, meta))
    li.appendChild(meta)
    reqApps.appendChild(li)
  }
  // Con plan, el botón izquierdo es "Cancelar" (`cancel`: no toca nada); sin plan es "Denegar todo" (deniega de verdad).
  reqDeny.textContent = req.plan ? 'Cancelar' : 'Denegar todo'
  reqDeny.hidden = false
  reqApprove.textContent = req.plan ? 'Aprobar y empezar' : 'Aprobar'
  reqError.textContent = ''
  setBusy(false)
  request.hidden = false
  pill.hidden = true
}

function hideRequest(): void {
  activeRequest = null
  request.hidden = true
  pill.hidden = false
}

function setBusy(v: boolean): void {
  busy = v
  for (const b of [reqApprove, reqDeny, reqEdit, reqClose]) b.disabled = v
}

type ResponseExtra = { feedback?: string; approvePlan?: boolean; cancel?: boolean }

async function respond(
  decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>,
  extra: ResponseExtra = {}
): Promise<void> {
  const req = activeRequest
  if (!req || busy) return
  setBusy(true)
  const r = await cowork?.invoke('computer:respondAccess', { id: req.id, decisions, ...extra })
  if (r && !r.ok) {
    reqError.textContent = `No se pudo responder: ${r.error}`
    setBusy(false)
    return
  }
  // La píldora vuelve a su tamaño normal cuando llegue `waitingCleared` (o de inmediato aquí, por
  // si el mensaje se perdiera): evita quedar "grande" colgada.
  hideRequest()
}

/** Esc, ✕ y "Cancelar": no toca ninguna concesión ni aprueba el plan. */
function cancelRequest(): void {
  void respond([], { cancel: true })
}

reqApprove.addEventListener('click', () => {
  const req = activeRequest
  if (!req) return
  // Takeover: "Permitir" aprueba sin decisiones por app (el nivel "full" ya lo declaró request_full_control).
  if (req.kind === 'takeover') {
    void respond([], { approvePlan: true })
    return
  }
  void respond(
    req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: choices[a.bundleId] ?? defaultAccessDecision(a) })),
    { approvePlan: !!req.plan }
  )
})
reqDeny.addEventListener('click', () => {
  const req = activeRequest
  if (!req) return
  // Takeover: "Seguir en segundo plano" no toca ninguna concesión (el agente sigue con app_*).
  if (req.kind === 'takeover') {
    cancelRequest()
    return
  }
  // Con plan el botón es "Cancelar" (sin efecto sobre las concesiones); sin plan es una denegación explícita.
  if (req.plan) cancelRequest()
  else void respond(req.apps.map((a) => ({ bundleId: a.bundleId, name: a.name, decision: 'deny' as const })))
})
reqClose.addEventListener('click', cancelRequest)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeRequest) cancelRequest()
})
reqEdit.addEventListener('click', () => {
  // Trae Lapis al frente (acción EXPLÍCITA del usuario) para escribir el feedback con más espacio;
  // la tarjeta sigue pendiente (no se responde desde aquí).
  void cowork?.invoke('computer:showMainWindow')
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
      hideRequest()
      return
    case 'waiting':
      document.body.classList.add('on')
      renderRequest(msg.request)
      return
    case 'waitingCleared':
      hideRequest()
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
if (location.hash === '#demo-request') {
  document.body.classList.add('on')
  renderRequest({
    id: 'demo',
    reason: 'Abrir Discord y unirme al canal “pega”',
    plan: ['Abrir Spotlight y buscar Discord', 'Abrir el canal #pega', 'Escribir un saludo'],
    apps: [
      { bundleId: 'com.hnc.Discord', name: 'Discord', requested: 'full', current: null },
      { bundleId: 'com.apple.Spotlight', name: 'Spotlight', requested: 'click', current: 'full' },
      { bundleId: 'com.apple.Notes', name: 'Notas', requested: 'view', current: 'view', denied: true }
    ],
    unresolved: ['Slack']
  })
}
// Tarjeta "¿Tomar el control de la pantalla?" (request_full_control desde el modo segundo plano).
if (location.hash === '#demo-takeover') {
  document.body.classList.add('on')
  renderRequest({
    id: 'demo-takeover',
    kind: 'takeover',
    reason: 'Necesita pulsar un atajo de teclado que app_press no puede reproducir',
    apps: [{ bundleId: 'com.hnc.Discord', name: 'Discord', requested: 'full', current: null }]
  })
}
// Plan sin apps (terminal, archivos o web): sin lista de apps; "Cancelar" en lugar de "Denegar todo".
if (location.hash === '#demo-plan-only') {
  document.body.classList.add('on')
  renderRequest({
    id: 'demo-plan-only',
    reason: 'Buscar el precio del dólar hoy y guardarlo en dolar.md',
    plan: ['Buscar en la web el precio del dólar', 'Escribir el resultado en dolar.md'],
    apps: []
  })
}
