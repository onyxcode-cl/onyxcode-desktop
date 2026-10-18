/**
 * Entrega 2, parte 1: elegir una sesión, escribirle (apagado por defecto), comandos que NO existen, reinicio y carreras con la pantalla.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { rulesetForMode } from '@shared/permission-rules'
import { permissionModeOf } from './engine-link'
import { readAudit } from './store'
import { linkOwner, makeRig, permission, settle, textPart, until, type Rig } from './test-kit'

let rig: Rig | null = null
afterEach(async () => {
  await rig?.stop()
  rig = null
})

const OWNER = 5001
const lastMsg = (r: Rig, chat = OWNER) => r.tg.to(chat).at(-1)
const buttons = (m: { reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } } | undefined) =>
  (m?.reply_markup?.inline_keyboard ?? []).flat()

async function ready(over: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  setLang('es')
  rig = await makeRig(over)
  await linkOwner(rig, OWNER)
  return rig
}

/** Dos sesiones elegibles (una de Chat y una de Code) y una en una carpeta que no está entre las permitidas. */
function seed(r: Rig): void {
  r.engine.addSession({ id: 's_chat', title: 'Revisar el informe', kind: 'chat', directory: '/chat', updatedAt: Date.now() - 5 * 60_000 })
  r.engine.addSession({
    id: 's_code',
    title: 'Arreglar el login',
    kind: 'code',
    directory: '/proj',
    mode: 'manual',
    updatedAt: Date.now() - 1000
  })
  r.engine.addSession({ id: 's_other', title: 'Carpeta ajena', kind: 'code', directory: '/otra', updatedAt: Date.now() })
  const u = r.engine.addUser('s_chat', 'Resume el contrato')
  void u
  r.engine.addAssistant('s_chat', [textPart('El contrato dura dos años y se renueva solo.')])
}

async function listSessions(r: Rig): Promise<ReturnType<typeof lastMsg>> {
  const n = r.tg.to(OWNER).length
  r.tg.sendUser({ chatId: OWNER, text: '/sesiones' })
  await until(() => r.tg.to(OWNER).length > n && buttons(lastMsg(r)).length > 0, 3000, 'lista de sesiones')
  return lastMsg(r)
}

async function pick(r: Rig, title: string): Promise<void> {
  const list = await listSessions(r)
  const idx = buttons(list).findIndex((b) => b.text.includes(title))
  expect(idx, `botón de «${title}»`).toBeGreaterThanOrEqual(0)
  const n = r.tg.to(OWNER).length
  r.tg.press({ chatId: OWNER, messageId: list!.message_id, data: buttons(list)[idx]!.callback_data! })
  await until(() => r.tg.to(OWNER).length > n, 3000, 'mensaje de selección')
}

describe('/sesiones y elegir una sesión', () => {
  it('lista las sesiones de Chat y de Code (título, modo, estado, hace cuánto) con un botón por cada una; las de otras carpetas no', async () => {
    const r = await ready()
    seed(r)
    r.engine.setBusy('s_code', true)
    const list = await listSessions(r)
    const text = list!.text
    expect(text).toContain('Revisar el informe')
    expect(text).toContain('Arreglar el login')
    expect(text).not.toContain('Carpeta ajena')
    expect(text).toContain('Chat')
    expect(text).toContain('Code: proj')
    expect(text).toContain('Preguntar siempre')
    expect(text).toContain('trabajando')
    expect(text).toContain('en reposo')
    expect(text).toMatch(/hace [45] min/)
    expect(buttons(list)).toHaveLength(2)
    // El botón no lleva datos: solo un identificador corto.
    for (const b of buttons(list)) expect(b.callback_data).toMatch(/^s:[A-Za-z0-9_-]{12}$/)
  })

  it('sin conversaciones lo dice', async () => {
    const r = await ready()
    r.tg.sendUser({ chatId: OWNER, text: '/sesiones' })
    await until(() => lastMsg(r)?.text.includes('No encontré') === true)
  })

  it('elegir una: queda como sesión activa (persistida), manda el último intercambio y dice que es solo lectura', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    const m = lastMsg(r)!
    expect(m.text).toContain('Siguiendo: <b>Revisar el informe</b>')
    expect(m.text).toContain('Resume el contrato')
    expect(m.text).toContain('dura dos años')
    expect(m.text).toContain('Solo lectura')
    expect(r.svc.getState().activeSession).toEqual({ title: 'Revisar el informe', kind: 'chat', folder: null })
    expect(r.store.load().active).toMatchObject({ id: 's_chat', directory: '/chat', kind: 'chat' })
    // /sesion dice cuál es
    r.tg.sendUser({ chatId: OWNER, text: '/sesion' })
    await until(() => lastMsg(r)!.text.includes('Conversación elegida'))
    expect(lastMsg(r)!.text).toContain('Revisar el informe')
    // /salir la suelta
    r.tg.sendUser({ chatId: OWNER, text: '/salir' })
    await until(() => lastMsg(r)!.text.includes('Dejé de seguir'))
    expect(r.store.load().active).toBeNull()
    expect(r.svc.getState().activeSession).toBeNull()
    r.tg.sendUser({ chatId: OWNER, text: '/sesion' })
    await until(() => lastMsg(r)!.text.includes('No hay una conversación'))
  })

  it('una de Code muestra la carpeta y avisa si está en «Todo sin preguntar»', async () => {
    const r = await ready()
    seed(r)
    r.engine.sessions.get('s_code')!.info.mode = 'bypass'
    await pick(r, 'Arreglar el login')
    const t = lastMsg(r)!.text
    expect(t).toContain('Code: proj')
    expect(t).toContain('Todo sin preguntar')
    expect(t).toContain('sin preguntar')
    expect(r.svc.getState().activeSession).toEqual({ title: 'Arreglar el login', kind: 'code', folder: 'proj' })
  })

  it.each([
    ['auto', 'Automático'],
    ['acceptEdits', 'Editar sin preguntar']
  ] as const)('también avisa en el modo «%s»', async (mode, label) => {
    const r = await ready()
    seed(r)
    r.engine.sessions.get('s_code')!.info.mode = mode
    await pick(r, 'Arreglar el login')
    expect(lastMsg(r)!.text).toContain(`«${label}»`)
    expect(lastMsg(r)!.text).toContain('puede actuar sin preguntar')
  })

  it('un modo sin identificar en Code también se avisa; en «Preguntar siempre» no hay aviso', async () => {
    const r = await ready()
    seed(r)
    r.engine.sessions.get('s_code')!.info.mode = 'unknown'
    await pick(r, 'Arreglar el login')
    expect(lastMsg(r)!.text).toContain('No pude saber en qué modo')
    r.engine.sessions.get('s_code')!.info.mode = 'manual'
    await pick(r, 'Arreglar el login')
    expect(lastMsg(r)!.text).not.toContain('puede actuar sin preguntar')
    expect(lastMsg(r)!.text).not.toContain('No pude saber')
  })

  it('los mismos nombres del motor: el modo se reconoce de las reglas reales de la sesión', () => {
    expect(permissionModeOf(rulesetForMode('bypass'), 'build')).toBe('bypass')
  })

  it('un botón de otro chat, caducado o inventado no elige nada', async () => {
    const r = await ready()
    seed(r)
    const list = await listSessions(r)
    const data = buttons(list)[0]!.callback_data!
    r.tg.press({ chatId: 777, fromId: 777, messageId: list!.message_id, data })
    r.tg.press({ chatId: OWNER, messageId: list!.message_id, data: 's:AAAAAAAAAAAA' })
    r.tg.press({ chatId: OWNER, messageId: list!.message_id, data: 's:' + 'B'.repeat(12) + 'x' })
    await settle(400)
    expect(r.store.load().active).toBeNull()
    r.clock.now += 11 * 60_000
    r.tg.press({ chatId: OWNER, messageId: list!.message_id, data })
    await until(() => r.tg.callbackAnswers.some((a) => a.text?.includes('caducó')))
    expect(r.store.load().active).toBeNull()
  })

  it('un chat ajeno que escribe /sesiones no recibe nada', async () => {
    const r = await ready()
    seed(r)
    const n = r.tg.messages.length
    r.tg.sendUser({ chatId: 9001, text: '/sesiones' })
    r.tg.sendUser({ chatId: 9001, text: '/sesion' })
    r.tg.sendUser({ chatId: -1002, fromId: OWNER, text: '/sesiones', chatType: 'group' })
    await settle(400)
    expect(r.tg.messages.length).toBe(n)
  })

  it('si la sesión elegida desaparece del motor, el bot lo dice y la suelta', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    r.engine.sessions.delete('s_chat')
    await r.svc.tick()
    await until(() => lastMsg(r)!.text.includes('ya no existe'))
    expect(r.store.load().active).toBeNull()
    expect(r.svc.getState().activeSession).toBeNull()
  })

  it('si el motor no responde (caído) NO se suelta la sesión', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    r.engine.down = true
    await r.svc.tick()
    await settle(200)
    expect(r.store.load().active?.id).toBe('s_chat')
  })

  it('si cambia el modo de permisos de la sesión, el bot lo avisa', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Arreglar el login')
    r.engine.sessions.get('s_code')!.info.mode = 'bypass'
    await r.svc.tick()
    await until(() => lastMsg(r)!.text.includes('Cambió el modo'))
    expect(lastMsg(r)!.text).toContain('Todo sin preguntar')
  })

  it('elegir otra sesión suelta la anterior: nada de la primera se sigue contando', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    await pick(r, 'Arreglar el login')
    expect(r.store.load().active?.id).toBe('s_code')
  })
})

describe('escribir a la sesión', () => {
  it('APAGADO por defecto: el texto no llega al motor y el bot dice cómo activarlo', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    expect(r.svc.getState().allowWrite).toBe(false)
    r.tg.sendUser({ chatId: OWNER, text: 'borra todo' })
    await until(() => lastMsg(r)!.text.includes('Escribir desde Telegram está apagado'))
    expect(r.engine.prompts).toHaveLength(0)
    expect(readAudit(r.store.auditFile).map((a) => a.kind)).toContain('message-blocked')
  })

  it('sin una sesión elegida el texto no va a ningún lado, ni con «escribir» encendido', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    r.tg.sendUser({ chatId: OWNER, text: 'hola' })
    await until(() => lastMsg(r)!.text.includes('/sesiones'))
    expect(r.engine.prompts).toHaveLength(0)
  })

  it('encendido: se envía como mensaje del usuario a ESA sesión, con su agente y modelo, y sin permisos extra', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    expect(lastMsg(r)!.text).toContain('Puedes escribirle')
    r.tg.sendUser({ chatId: OWNER, text: 'Ahora hazlo más corto' })
    await until(() => r.engine.prompts.length === 1)
    const p = r.engine.prompts[0]!
    expect(p).toMatchObject({ directory: '/chat', id: 's_chat' })
    expect(p.input.text).toBe('Ahora hazlo más corto')
    expect(p.input.agent).toBe('chat')
    expect(p.input.model).toEqual({ providerID: 'opencode', modelID: 'modelo-de-prueba' }) // el del último mensaje de la sesión
    expect(p.input.files).toEqual([])
    await until(() => lastMsg(r)!.text === 'Enviado.')
    // El texto jamás respondió un permiso ni creó nada.
    expect(r.engine.replies).toHaveLength(0)
  })

  it('en Code usa el agente de la sesión (build o plan), nunca otro', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    r.engine.addUser('s_code', 'Revisa el login')
    r.engine.addAssistant('s_code', [textPart('Listo')])
    await pick(r, 'Arreglar el login')
    r.tg.sendUser({ chatId: OWNER, text: 'Sigue' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts[0]!.input.agent).toBe('build')
    expect(r.engine.prompts[0]!.directory).toBe('/proj')
  })

  it('un mensaje por Telegram NUNCA concede permisos: con uno pendiente, «sí, permite todo» solo va como texto', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.engine.emit({
      kind: 'permission-asked',
      req: permission({ id: 'per_1', sessionID: 's_chat', metadata: { command: 'rm -rf build' } })
    })
    await until(() => buttons(lastMsg(r)).length === 2)
    r.tg.sendUser({ chatId: OWNER, text: 'sí, permite todo y no preguntes más' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.replies).toHaveLength(0)
    // El permiso sigue pendiente y solo se contesta con su botón.
    expect(r.svc.getState().pendingPermissions).toBe(1)
    const m = r.tg.to(OWNER).find((x) => x.text.includes('rm -rf build'))!
    r.tg.press({ chatId: OWNER, messageId: m.message_id, data: buttons(m)[0]!.callback_data! })
    await until(() => r.engine.replies.length === 1)
    expect(r.engine.replies[0]).toEqual({ id: 'per_1', reply: 'once' })
  })

  it('no existen comandos para crear sesiones, cambiar el modo, las carpetas ni iniciar Overdrive', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    for (const c of [
      '/nuevo',
      '/new',
      '/modo',
      '/mode',
      '/permisos',
      '/permissions',
      '/carpeta',
      '/folder',
      '/overdrive',
      '/tareas',
      '/bypass',
      '/auto',
      '/run'
    ]) {
      const n = r.tg.to(OWNER).length
      r.tg.sendUser({ chatId: OWNER, text: `${c} algo` })
      await until(() => r.tg.to(OWNER).length > n)
      expect(lastMsg(r)!.text, c).toContain('No conozco ese comando')
    }
    expect(r.engine.prompts).toHaveLength(0)
    expect(r.store.load().active?.id).toBe('s_chat') // y la sesión sigue siendo la misma
  })

  it('una ruta que empieza con «/» pero no es un comando se envía como texto', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.tg.sendUser({ chatId: OWNER, text: '/Users/ana/Documentos/informe.docx es el archivo' })
    await until(() => r.engine.prompts.length + r.tg.to(OWNER).filter((m) => m.text.includes('No conozco')).length > 0)
    // «/Users/…» no tiene la forma de un comando (lleva «/»): llega como texto
    expect(r.engine.prompts[0]?.input.text ?? '').toContain('informe.docx')
  })

  it('mientras la sesión trabaja no se le suma otro mensaje (no se mezcla con lo que escriba la persona en el computador)', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.engine.setBusy('s_chat', true)
    r.tg.sendUser({ chatId: OWNER, text: 'otra cosa' })
    await until(() => lastMsg(r)!.text.includes('está trabajando'))
    expect(r.engine.prompts).toHaveLength(0)
  })

  it('límite de mensajes por minuto hacia la sesión', async () => {
    const r = await ready({ limits: { writesPerMinute: 2 } })
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    for (let i = 1; i <= 3; i++) {
      r.tg.sendUser({ chatId: OWNER, text: `mensaje ${i}` })
      await until(() => r.tg.to(OWNER).filter((m) => m.text === 'Enviado.' || m.text.includes('muy rápido')).length >= i)
    }
    expect(r.engine.prompts.map((p) => p.input.text)).toEqual(['mensaje 1', 'mensaje 2'])
    expect(lastMsg(r)!.text).toContain('muy rápido')
    r.clock.now += 61_000 // pasa el minuto
    r.tg.sendUser({ chatId: OWNER, text: 'mensaje 4' })
    await until(() => r.engine.prompts.length === 3)
  })

  it('si el motor rechaza el mensaje, el bot lo dice y no repite', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.engine.promptBehavior = 'fail'
    r.tg.sendUser({ chatId: OWNER, text: 'hola' })
    await until(() => lastMsg(r)!.text.includes('No pude enviarlo'))
    expect(r.engine.prompts).toHaveLength(0)
  })

  it('apagar «escribir» detiene los envíos al instante; quedó registrado sin el contenido', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.tg.sendUser({ chatId: OWNER, text: 'primero' })
    await until(() => r.engine.prompts.length === 1)
    r.svc.setAllowWrite(false)
    r.tg.sendUser({ chatId: OWNER, text: 'segundo' })
    await until(() => lastMsg(r)!.text.includes('está apagado'))
    expect(r.engine.prompts).toHaveLength(1)
    const audit = readAudit(r.store.auditFile)
    expect(audit.filter((a) => a.kind === 'write-toggled').map((a) => a.on)).toEqual([false, true])
    const raw = readFileSync(r.store.auditFile, 'utf8')
    expect(raw).not.toContain('primero')
    expect(raw).not.toContain('Revisar el informe')
    expect(raw).not.toContain('s_chat')
    expect(audit.find((a) => a.kind === 'message-sent')).toMatchObject({ mode: 'chat', bytes: 7 })
  })

  it('«Detener todo», desvincular y quitar el bot apagan «escribir» y sueltan la sesión', async () => {
    for (const how of ['panic', 'unlink', 'removeBot'] as const) {
      const r = await ready()
      seed(r)
      r.svc.setAllowWrite(true)
      await pick(r, 'Revisar el informe')
      r.svc[how]()
      expect(r.store.load()).toMatchObject({ allowWrite: false, active: null })
      expect(r.svc.getState()).toMatchObject({ allowWrite: false, activeSession: null })
      await rig?.stop()
      rig = null
    }
  })

  it('apagar Telegram (interruptor general) también suelta la sesión y la escritura', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.svc.setEnabled(false)
    expect(r.store.load()).toMatchObject({ allowWrite: false, active: null })
  })
})

describe('reinicios y repeticiones', () => {
  it('al reiniciar retoma la sesión activa y NO vuelve a mandar lo ya contado', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    const sent = r.tg.to(OWNER).length
    const svc2 = r.restart()
    await until(() => svc2.getState().phase === 'linked')
    expect(svc2.getState().activeSession).toMatchObject({ title: 'Revisar el informe' })
    await settle(500)
    expect(r.tg.to(OWNER).length).toBe(sent)
    // y sigue valiendo para escribir cuando se active
    svc2.setAllowWrite(true)
    r.tg.sendUser({ chatId: OWNER, text: 'sigamos' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts[0]!.id).toBe('s_chat')
  })

  it('el mismo mensaje de Telegram (repetido tras un reinicio a medio atender) no se envía dos veces', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.tg.sendUser({ chatId: OWNER, text: 'una sola vez' })
    await until(() => r.engine.prompts.length === 1)
    const id = r.store.load().lastWriteId
    expect(id).toBeGreaterThan(0)
    // Telegram vuelve a entregar el mismo mensaje (mismo message_id).
    await r.svc.handleUpdate({
      update_id: 999999,
      message: { message_id: id, from: { id: OWNER, first_name: 'Ana' }, chat: { id: OWNER, type: 'private' }, text: 'una sola vez' }
    })
    expect(r.engine.prompts).toHaveLength(1)
  })

  it('la sesión guardada que ya no existe al arrancar se avisa y se suelta', async () => {
    const r = await ready()
    seed(r)
    await pick(r, 'Revisar el informe')
    r.engine.sessions.delete('s_chat')
    const svc2 = r.restart()
    await until(() => svc2.getState().activeSession === null)
    await until(() => lastMsg(r)!.text.includes('ya no existe'))
  })

  it('el estado guardado no tiene el contenido de la conversación ni el texto de los mensajes', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await pick(r, 'Revisar el informe')
    r.tg.sendUser({ chatId: OWNER, text: 'texto privado de la persona' })
    await until(() => r.engine.prompts.length === 1)
    const state = readFileSync(r.store.stateFile, 'utf8')
    expect(state).not.toContain('texto privado')
    expect(state).not.toContain('dura dos años')
    const files = readdirSync(r.dir)
    for (const f of files) {
      if (f.endsWith('.bin')) continue
      expect(readFileSync(join(r.dir, f), 'utf8'), f).not.toContain('texto privado')
    }
    expect(existsSync(r.store.stateFile)).toBe(true)
  })
})
