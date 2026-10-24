/**
 * Entrega 2, parte 2: avance en vivo (un mensaje editado), respuesta final partida, salidas largas con «Ver todo»,
 * modo «solo resúmenes», archivos que salen y archivos que entran, y que NADA llegue a una sesión no elegida.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { htmlProblem, visibleText } from '../../../e2e/fake-telegram/server.mjs'
import type { EnginePart } from './engine-link'
import { chunkAnswer } from './format'
import { readAudit } from './store'
import { linkOwner, makeRig, settle, textPart, toolPart, until, type Rig } from './test-kit'

let rig: Rig | null = null
const tmp: string[] = []
afterEach(async () => {
  await rig?.stop()
  rig = null
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true })
})

const OWNER = 5001
const lastMsg = (r: Rig) => r.tg.to(OWNER).at(-1)
type Markup = { reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } } | undefined
const buttons = (m: Markup) => (m?.reply_markup?.inline_keyboard ?? []).flat()
/** Clave de mentira armada en tiempo de ejecución. */
const fakeKey = (): string => ['sk', 'proj', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('-')

async function ready(over: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  setLang('es')
  rig = await makeRig(over)
  await linkOwner(rig, OWNER)
  return rig
}

function mkdir(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-tg-live-')))
  tmp.push(d)
  return d
}

/** Elige la sesión `id` por el camino real (/sesiones + botón). */
async function choose(r: Rig, title: string): Promise<void> {
  const n = r.tg.to(OWNER).length
  r.tg.sendUser({ chatId: OWNER, text: '/sesiones' })
  await until(() => r.tg.to(OWNER).length > n && buttons(lastMsg(r)).length > 0)
  const list = lastMsg(r)!
  const b = buttons(list).find((x) => x.text.includes(title))!
  const before = r.tg.to(OWNER).length
  r.tg.press({ chatId: OWNER, messageId: list.message_id, data: b.callback_data! })
  await until(() => r.tg.to(OWNER).length > before)
}

function startTurn(r: Rig, sid: string, userText: string): void {
  r.engine.addUser(sid, userText)
  r.engine.addAssistant(sid, [], { completed: false })
  r.engine.setBusy(sid, true)
  r.engine.emit({ kind: 'status', sessionID: sid, status: 'busy' })
}
function progress(r: Rig, sid: string, parts: EnginePart[]): void {
  r.engine.setLastAssistant(sid, parts, false)
  r.engine.emit({ kind: 'activity', sessionID: sid })
}
function finishTurn(r: Rig, sid: string, parts: EnginePart[]): void {
  r.engine.setLastAssistant(sid, parts, true)
  r.engine.setBusy(sid, false)
  r.engine.emit({ kind: 'status', sessionID: sid, status: 'idle' })
}
const live = (r: Rig) => r.tg.to(OWNER).find((m) => /Trabajando|Trabajó/.test(m.text))
const lastEditOf = (r: Rig, id: number) => [...r.tg.edits].reverse().find((e) => e.message_id === id)
/** Texto actual de un mensaje (el último editado, o el original). */
const currentText = (r: Rig, id: number): string => lastEditOf(r, id)?.text ?? r.tg.to(OWNER).find((m) => m.message_id === id)?.text ?? ''

function seed(r: Rig, dirs = { chat: '/chat', code: '/proj' }): void {
  r.engine.addSession({ id: 's_a', title: 'Sesión A', kind: 'chat', directory: dirs.chat, updatedAt: Date.now() - 1000 })
  r.engine.addSession({ id: 's_b', title: 'Sesión B', kind: 'chat', directory: dirs.chat, updatedAt: Date.now() - 2000 })
  r.engine.addSession({ id: 's_code', title: 'Proyecto', kind: 'code', directory: dirs.code, mode: 'manual', updatedAt: Date.now() - 3000 })
  for (const sid of ['s_a', 's_b']) {
    r.engine.addUser(sid, 'pregunta vieja')
    r.engine.addAssistant(sid, [textPart('respuesta vieja')])
  }
}

describe('avance en vivo: un mensaje que se edita', { retry: 2 }, () => {
  it('un solo mensaje con una línea por paso en lenguaje llano; al terminar se cierra y llega la respuesta final como mensaje nuevo', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Revisa el proyecto')
    progress(r, 's_a', [toolPart('read', { filePath: '/proj/src/App.tsx' }, 'completed')])
    await until(() => live(r) !== undefined)
    const msg = live(r)!
    expect(msg.text).toContain('Trabajando…')
    expect(msg.text).toContain('Leyó App.tsx')
    progress(r, 's_a', [
      toolPart('read', { filePath: '/proj/src/App.tsx' }, 'completed'),
      toolPart('bash', { command: 'npm test', description: 'Corre las pruebas' }, 'running'),
      toolPart('write', { filePath: '/proj/informe.md', content: 'x' }, 'completed')
    ])
    await until(() => currentText(r, msg.message_id).includes('Corre las pruebas'))
    const mid = currentText(r, msg.message_id)
    expect(mid).toContain('Ejecutando: Corre las pruebas')
    expect(mid).toContain('Creó informe.md')
    expect(mid).toContain('3 pasos')
    // Un solo mensaje de avance (se edita, no se repite).
    expect(r.tg.to(OWNER).filter((m) => /Trabajando|Trabajó/.test(m.text))).toHaveLength(1)

    finishTurn(r, 's_a', [
      toolPart('read', { filePath: '/proj/src/App.tsx' }, 'completed'),
      toolPart('bash', { command: 'npm test', description: 'Corre las pruebas' }, 'completed', { output: 'ok' }),
      toolPart('write', { filePath: '/proj/informe.md', content: 'x' }, 'completed'),
      textPart('Todo quedó listo: las pruebas pasan.')
    ])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('Todo quedó listo')))
    const final = r.tg.to(OWNER).find((m) => m.text.includes('Todo quedó listo'))!
    expect(final.message_id).not.toBe(msg.message_id) // la respuesta es un mensaje NUEVO
    await until(() => currentText(r, msg.message_id).includes('Trabajó durante'))
    expect(currentText(r, msg.message_id)).toContain('3 pasos')
    expect(currentText(r, msg.message_id)).not.toContain('Trabajando…')
    await settle(300)
    // sin aviso duplicado de «Terminó» (la respuesta final ya lo dice) y sin repetir la respuesta
    expect(r.tg.to(OWNER).filter((m) => m.text.startsWith('Terminó'))).toHaveLength(0)
    expect(r.tg.to(OWNER).filter((m) => m.text.includes('Todo quedó listo'))).toHaveLength(1)
    // Todo respeta HTML y tope (el servidor falso rechaza lo contrario con 400).
    for (const m of r.tg.to(OWNER)) expect(htmlProblem(m.text)).toBeNull()
  })

  it('una respuesta sin herramientas no crea mensaje de avance: solo llega la respuesta', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Hola')
    finishTurn(r, 's_a', [textPart('¡Hola! ¿En qué te ayudo?')])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('¿En qué te ayudo?')))
    expect(live(r)).toBeUndefined()
  })

  it('límite de ritmo: las ediciones van separadas por el intervalo mínimo aunque lleguen decenas de eventos', async () => {
    const r = await ready({ limits: { liveEditGapMs: 300 } })
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Trabajo largo')
    const steps: EnginePart[] = []
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) {
      steps.push(toolPart('read', { filePath: `/proj/archivo${i}.ts` }, 'completed'))
      progress(r, 's_a', [...steps])
      await settle(40)
    }
    await until(() => currentText(r, live(r)!.message_id).includes('archivo29.ts'), 4000)
    const elapsed = Date.now() - t0
    const msg = live(r)!
    const times = [msg.at, ...r.tg.edits.filter((e) => e.message_id === msg.message_id).map((e) => e.at)]
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!, `edición ${i}`).toBeGreaterThanOrEqual(270)
    // 30 eventos en ~1,2 s → como mucho una edición cada 0,3 s, no 30.
    expect(times.length).toBeLessThanOrEqual(Math.ceil(elapsed / 270) + 2)
    expect(times.length).toBeLessThan(12)
  })

  it('respeta el límite del servidor: ante un 429 espera retry_after y el mensaje termina bien', async () => {
    const sleeps: number[] = []
    const r = await ready({
      limits: { liveEditGapMs: 250 },
      editFloodMs: 1200,
      sleep: async (ms) => {
        sleeps.push(ms)
        await new Promise((res) => setTimeout(res, 20))
      }
    })
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Trabajo')
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' })])
    await until(() => live(r) !== undefined)
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' }), toolPart('read', { filePath: '/p/dos.ts' })])
    await until(() => r.tg.edits.length === 1, 4000, 'primera edición')
    progress(r, 's_a', [
      toolPart('read', { filePath: '/p/uno.ts' }),
      toolPart('read', { filePath: '/p/dos.ts' }),
      toolPart('read', { filePath: '/p/dos.ts' })
    ])
    await until(() => sleeps.includes(1000) || sleeps.includes(2000), 4000, 'esperó retry_after')
    // Aunque algún intento falló por el límite, el siguiente aviso del motor deja el mensaje al día.
    await settle(1400)
    progress(r, 's_a', [
      toolPart('read', { filePath: '/p/uno.ts' }),
      toolPart('read', { filePath: '/p/dos.ts' }),
      toolPart('read', { filePath: '/p/tres.ts' })
    ])
    await until(() => currentText(r, live(r)!.message_id).includes('tres.ts'), 6000)
    expect(r.svc.getState().error).toBeNull()
  })

  it('si la persona borra el mensaje de avance, el siguiente paso crea uno nuevo', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Trabajo')
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' })])
    await until(() => live(r) !== undefined)
    r.tg.deleteMessage(OWNER, live(r)!.message_id)
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' }), toolPart('read', { filePath: '/p/dos.ts' })])
    await settle(300)
    progress(r, 's_a', [
      toolPart('read', { filePath: '/p/uno.ts' }),
      toolPart('read', { filePath: '/p/dos.ts' }),
      toolPart('read', { filePath: '/p/tres.ts' })
    ])
    await until(() => live(r) !== undefined && currentText(r, live(r)!.message_id).includes('tres.ts'), 4000)
  })

  it('con muchos pasos solo se ven los últimos y el mensaje nunca pasa del tope', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Trabajo enorme')
    const steps = Array.from({ length: 200 }, (_, i) =>
      toolPart('bash', { command: `echo ${'x'.repeat(300)} ${i}` }, 'completed', { output: 'o'.repeat(5000) })
    )
    progress(r, 's_a', steps)
    await until(() => live(r) !== undefined)
    const t = currentText(r, live(r)!.message_id)
    expect(visibleText(t).length).toBeLessThanOrEqual(4096)
    expect(t).toContain('200 pasos')
    expect(t).toMatch(/y \d+ pasos anteriores/)
    expect(htmlProblem(t)).toBeNull()
  })

  it('un turno que escribe la persona en el computador es otro turno: su propio mensaje y su propio cierre, sin duplicados', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Primera pregunta')
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' })])
    await until(() => live(r) !== undefined)
    finishTurn(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' }), textPart('Respuesta uno')])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('Respuesta uno')))
    // La persona escribe en el computador un segundo mensaje.
    startTurn(r, 's_a', 'Segunda pregunta (desde la pantalla)')
    progress(r, 's_a', [toolPart('glob', { pattern: '*.md' })])
    await until(() => r.tg.to(OWNER).filter((m) => /Trabajando|Trabajó/.test(m.text)).length === 2)
    finishTurn(r, 's_a', [toolPart('glob', { pattern: '*.md' }), textPart('Respuesta dos')])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('Respuesta dos')))
    await settle(300)
    expect(r.tg.to(OWNER).filter((m) => m.text.includes('Respuesta uno'))).toHaveLength(1)
    expect(r.tg.to(OWNER).filter((m) => m.text.includes('Respuesta dos'))).toHaveLength(1)
    // Un evento «idle» repetido no vuelve a mandar nada.
    const n = r.tg.messages.length
    r.engine.emit({ kind: 'status', sessionID: 's_a', status: 'idle' })
    r.engine.emit({ kind: 'status', sessionID: 's_a', status: 'idle' })
    await settle(300)
    expect(r.tg.messages.length).toBe(n)
  })

  it('reiniciar a mitad de un turno terminado no repite la respuesta', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Pregunta')
    finishTurn(r, 's_a', [textPart('Respuesta única')])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('Respuesta única')))
    const n = r.tg.messages.length
    const svc2 = r.restart()
    await until(() => svc2.getState().phase === 'linked')
    r.engine.emit({ kind: 'status', sessionID: 's_a', status: 'idle' })
    await svc2.tick()
    await settle(500)
    expect(r.tg.messages.length).toBe(n)
  })

  it('un error del asistente se cuenta una vez, con el detalle tapado', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Hazlo')
    r.engine.setLastAssistant('s_a', [], true)
    const list = r.engine.sessions.get('s_a')!.messages
    list[list.length - 1]!.error = `fallo con ${fakeKey()}`
    r.engine.setBusy('s_a', false)
    r.engine.emit({ kind: 'status', sessionID: 's_a', status: 'idle' })
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('terminó con un error')))
    const m = r.tg.to(OWNER).find((x) => x.text.includes('terminó con un error'))!
    expect(m.text).not.toContain(fakeKey())
  })
})

describe('respuesta final', { retry: 2 }, () => {
  it('una respuesta larga llega partida en trozos válidos y en orden', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    const para = (i: number): string => `Sección ${i}\n` + 'Texto con **negrita**, `código` y <etiquetas> & símbolos. '.repeat(30)
    const text = Array.from({ length: 4 }, (_, i) => para(i)).join('\n\n') + '\n```js\n' + 'let a = "<b>";\n'.repeat(120) + '```\nFin.'
    expect(chunkAnswer(text).length).toBeGreaterThan(2)
    expect(chunkAnswer(text).length).toBeLessThanOrEqual(6)
    startTurn(r, 's_a', 'Dame un informe largo')
    finishTurn(r, 's_a', [textPart(text)])
    await until(() => r.tg.to(OWNER).some((m) => m.text.endsWith('Fin.')), 5000)
    const chunks = r.tg.to(OWNER).filter((m) => m.text.includes('Sección') || m.text.includes('let a') || m.text.endsWith('Fin.'))
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) {
      expect(htmlProblem(c.text)).toBeNull()
      expect(visibleText(c.text).length).toBeLessThanOrEqual(4096)
    }
    const all = chunks.map((c) => visibleText(c.text)).join('')
    const pos = [0, 2, 3].map((i) => all.indexOf(`Sección ${i}`))
    expect(pos.every((p) => p >= 0)).toBe(true)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
  })

  it('una respuesta larguísima se manda como archivo, con un resumen al principio y sin claves', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    const text = 'Capítulo uno. ' + 'palabra '.repeat(8000) + `\nclave: ${fakeKey()}\n` + 'fin del libro'
    startTurn(r, 's_a', 'Escribe un libro')
    finishTurn(r, 's_a', [textPart(text)])
    await until(() => r.tg.documents.length === 1, 5000)
    const d = r.tg.documents[0]!
    expect(d.filename).toBe('respuesta.md')
    expect(d.bytes.toString()).toContain('fin del libro')
    expect(d.bytes.toString()).not.toContain(fakeKey())
    expect(d.caption).toContain('Capítulo uno')
    expect(htmlProblem(d.caption!)).toBeNull()
    expect(r.tg.to(OWNER).filter((m) => m.text.includes('palabra palabra')).length).toBe(0)
  })

  it('las claves de la respuesta se tapan antes de enviar', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Dime la clave')
    finishTurn(r, 's_a', [textPart(`La clave es ${fakeKey()} y sirve.`)])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('sirve.')))
    expect(
      r.tg
        .to(OWNER)
        .map((m) => m.text)
        .join('\n')
    ).not.toContain(fakeKey())
  })
})

describe('salidas largas, «Ver todo» y «solo resúmenes»', { retry: 2 }, () => {
  const longOutput = (): string => 'PRIMERA LINEA\n' + 'linea de salida con datos\n'.repeat(400) + `token ${fakeKey()}\nULTIMA LINEA`

  it('la salida de un comando se recorta con inicio y final y «Ver todo» manda un archivo completo (con claves tapadas)', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Corre las pruebas')
    progress(r, 's_a', [toolPart('bash', { command: 'npm test' }, 'completed', { output: longOutput() })])
    await until(() => live(r) !== undefined)
    const t = live(r)!
    const text = currentText(r, t.message_id)
    expect(text).toContain('<pre>')
    expect(text).toContain('PRIMERA LINEA')
    expect(text).toContain('ULTIMA LINEA')
    expect(text).toContain('omitidos')
    expect(text).not.toContain(fakeKey())
    expect(text.length).toBeLessThan(2000)
    const btn = buttons(lastEditOf(r, t.message_id) ?? t).find((b) => b.text.startsWith('Ver todo'))
    expect(btn).toBeDefined()
    r.tg.press({ chatId: OWNER, messageId: t.message_id, data: btn!.callback_data! })
    await until(() => r.tg.documents.length === 1)
    const body = r.tg.documents[0]!.bytes.toString()
    expect(body).toContain('PRIMERA LINEA')
    expect(body).toContain('ULTIMA LINEA')
    expect(body.split('\n').length).toBeGreaterThan(300)
    expect(body).not.toContain(fakeKey())
    // se puede pedir otra vez
    r.tg.press({ chatId: OWNER, messageId: t.message_id, data: btn!.callback_data! })
    await until(() => r.tg.documents.length === 2)
    const audit = readAudit(r.store.auditFile).filter((a) => a.kind === 'file-sent')
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ mode: 'chat', ext: 'txt' })
  })

  it('un diff largo de una edición también se recorta y tiene «Ver todo»', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Edita')
    const diff = '--- a/x\n+++ b/x\n' + '+línea nueva muy larga con contenido\n'.repeat(300)
    progress(r, 's_a', [toolPart('edit', { filePath: '/p/x.ts' }, 'completed', { diff })])
    await until(() => live(r) !== undefined)
    expect(currentText(r, live(r)!.message_id)).toContain('<pre>')
    expect(buttons(live(r)).some((b) => b.text.startsWith('Ver todo'))).toBe(true)
  })

  it('«Solo resúmenes»: ni salidas de comandos ni contenido de archivos ni botones; sí lo que hizo y la respuesta final', async () => {
    const r = await ready()
    seed(r)
    r.svc.setSummariesOnly(true)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Corre las pruebas')
    progress(r, 's_a', [toolPart('bash', { command: 'npm test' }, 'completed', { output: 'SALIDA SECRETA DEL COMANDO' })])
    await until(() => live(r) !== undefined)
    const text = currentText(r, live(r)!.message_id)
    expect(text).toContain('Ejecutó: npm test')
    expect(text).not.toContain('SALIDA SECRETA')
    expect(text).not.toContain('<pre>')
    expect(buttons(live(r))).toHaveLength(0)
    finishTurn(r, 's_a', [
      toolPart('bash', { command: 'npm test' }, 'completed', { output: 'SALIDA SECRETA DEL COMANDO' }),
      textPart('Pasaron todas.')
    ])
    await until(() => r.tg.to(OWNER).some((m) => m.text.includes('Pasaron todas.')))
    const everything = [...r.tg.messages, ...r.tg.edits].map((m) => m.text).join('\n')
    expect(everything).not.toContain('SALIDA SECRETA')
    expect(r.tg.documents).toHaveLength(0)
    expect(readAudit(r.store.auditFile).some((a) => a.kind === 'summaries-toggled' && a.on === true)).toBe(true)
  })

  it('apagar la salida completa: un botón «Ver todo» viejo no manda nada si luego se activa «solo resúmenes»', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Corre')
    progress(r, 's_a', [toolPart('bash', { command: 'npm test' }, 'completed', { output: longOutput() })])
    await until(() => live(r) !== undefined)
    const t = live(r)!
    const btn = buttons(lastEditOf(r, t.message_id) ?? t).find((b) => b.text.startsWith('Ver todo'))!
    r.svc.setSummariesOnly(true)
    r.tg.press({ chatId: OWNER, messageId: t.message_id, data: btn.callback_data! })
    await until(() => r.tg.callbackAnswers.some((a) => a.text?.includes('Solo resúmenes')))
    expect(r.tg.documents).toHaveLength(0)
  })

  it('una clave en el comando o en la salida se tapa también en las líneas de avance', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Llama a la API')
    progress(r, 's_a', [
      toolPart(
        'bash',
        { command: `curl -H "Authorization: Bearer ${'abcdEFGH1234'.repeat(3)}" https://x.test ${fakeKey()}` },
        'completed',
        { output: `ok ${fakeKey()}` }
      )
    ])
    await until(() => live(r) !== undefined)
    const all = [...r.tg.messages, ...r.tg.edits].map((m) => m.text).join('\n')
    expect(all).not.toContain(fakeKey())
    expect(all).not.toContain('abcdEFGH1234abcdEFGH1234')
  })
})

describe('archivos que crea la IA: «Recibir archivo»', { retry: 2 }, () => {
  async function projectRig(): Promise<{ r: Rig; proj: string; outside: string }> {
    const base = mkdir()
    const proj = join(base, 'proyecto')
    const outside = join(base, 'fuera')
    mkdirSync(proj)
    mkdirSync(outside)
    const r = await ready({
      sessionDirs: [
        { directory: '/chat', kind: 'chat' },
        { directory: proj, kind: 'code' }
      ],
      fileRoots: (s) => (s.kind === 'code' ? [s.directory] : ['/chat'])
    })
    r.engine.addSession({ id: 's_code', title: 'Proyecto', kind: 'code', directory: proj, mode: 'manual' })
    r.engine.addUser('s_code', 'inicio')
    r.engine.addAssistant('s_code', [textPart('listo')])
    return { r, proj, outside }
  }

  it(
    'ofrece un botón por archivo creado y lo manda como documento; rechaza secretos, ejecutables, fuera de carpeta y enormes',
    async () => {
      const { r, proj, outside } = await projectRig()
      const put = (dir: string, name: string, data: string | Buffer = 'contenido de ' + name): string => {
        const f = join(dir, name)
        mkdirSync(join(f, '..'), { recursive: true })
        writeFileSync(f, data)
        return f
      }
      const good1 = put(proj, 'informe.md', '# Informe\nTodo bien')
      const good2 = put(proj, 'docs/resumen.txt')
      const env = put(proj, '.env', 'API=1')
      const pem = put(proj, 'clave.pem', 'KEY')
      const sh = put(proj, 'instalar.sh', 'rm -rf /')
      const git = put(proj, '.git/config', '[core]')
      const away = put(outside, 'ajeno.md')
      const huge = put(proj, 'enorme.pdf', 'x')
      truncateSync(huge, 51 * 1024 * 1024)
      const link = join(proj, 'atajo.md')
      symlinkSync(away, link)
      await choose(r, 'Proyecto')
      startTurn(r, 's_code', 'Genera los archivos')
      const written = [good1, good2, env, pem, sh, git, away, huge, link].map((f) =>
        toolPart('write', { filePath: f, content: 'x' }, 'completed')
      )
      finishTurn(r, 's_code', [...written, textPart('Archivos creados.')])
      await until(() => buttons(lastMsg(r)).length > 0, 4000, 'botones de archivos')
      const btns = buttons(lastMsg(r))
      expect(btns.map((b) => b.text).sort()).toEqual(['Recibir archivo: informe.md', 'Recibir archivo: resumen.txt'])
      for (const b of btns) expect(b.callback_data).toMatch(/^f:[A-Za-z0-9_-]{12}$/)
      expect(lastMsg(r)!.text).not.toContain(proj) // nunca se muestran rutas completas
      r.tg.press({ chatId: OWNER, messageId: lastMsg(r)!.message_id, data: btns[0]!.callback_data! })
      r.tg.press({ chatId: OWNER, messageId: lastMsg(r)!.message_id, data: btns[1]!.callback_data! })
      await until(() => r.tg.documents.length === 2)
      expect(r.tg.documents.map((d) => d.filename).sort()).toEqual(['informe.md', 'resumen.txt'])
      expect(r.tg.documents.find((d) => d.filename === 'informe.md')!.bytes.toString()).toBe('# Informe\nTodo bien')
      const audit = readAudit(r.store.auditFile).filter((a) => a.kind === 'file-sent')
      expect(audit).toHaveLength(2)
      expect(JSON.stringify(audit)).not.toContain('informe')
      expect(JSON.stringify(audit)).not.toContain(proj)
    },
    { retry: 2 }
  )

  it('se vuelve a validar al pulsar: si el archivo se cambió por un enlace a otra carpeta o por un secreto, no se manda', async () => {
    const { r, proj, outside } = await projectRig()
    const f = join(proj, 'reporte.md')
    writeFileSync(f, 'inocente')
    const secret = join(outside, 'secreto.txt')
    writeFileSync(secret, 'datos privados')
    await choose(r, 'Proyecto')
    startTurn(r, 's_code', 'Crea el reporte')
    finishTurn(r, 's_code', [toolPart('write', { filePath: f, content: 'x' }), textPart('Hecho.')])
    await until(() => buttons(lastMsg(r)).length === 1)
    const m = lastMsg(r)!
    const data = buttons(m)[0]!.callback_data!
    rmSync(f)
    symlinkSync(secret, f)
    r.tg.press({ chatId: OWNER, messageId: m.message_id, data })
    await until(() => r.tg.to(OWNER).some((x) => x.text.includes('fuera de las carpetas')))
    expect(r.tg.documents).toHaveLength(0)
    expect(readAudit(r.store.auditFile).some((a) => a.kind === 'file-refused')).toBe(true)
  })

  it('un botón de archivo de otra sesión ya no vale', async () => {
    const { r, proj } = await projectRig()
    const f = join(proj, 'reporte.md')
    writeFileSync(f, 'x')
    r.engine.addSession({ id: 's_otra', title: 'Otra', kind: 'chat', directory: '/chat' })
    await choose(r, 'Proyecto')
    startTurn(r, 's_code', 'Crea')
    finishTurn(r, 's_code', [toolPart('write', { filePath: f, content: 'x' }), textPart('Hecho.')])
    await until(() => buttons(lastMsg(r)).length === 1)
    const m = lastMsg(r)!
    const data = buttons(m)[0]!.callback_data!
    await choose(r, 'Otra')
    r.tg.press({ chatId: OWNER, messageId: m.message_id, data })
    await until(() => r.tg.callbackAnswers.some((a) => a.text?.includes('caducaron') || a.text?.includes('caducó')))
    expect(r.tg.documents).toHaveLength(0)
  })

  it('un botón inventado o de otro chat no manda nada', async () => {
    const { r, proj } = await projectRig()
    writeFileSync(join(proj, 'a.md'), 'x')
    await choose(r, 'Proyecto')
    r.tg.press({ chatId: OWNER, messageId: 1, data: 'f:AAAAAAAAAAAA' })
    r.tg.press({ chatId: 4242, fromId: 4242, messageId: 1, data: 'f:AAAAAAAAAAAA' })
    r.tg.press({ chatId: OWNER, messageId: 1, data: '../../etc/passwd' })
    await settle(400)
    expect(r.tg.documents).toHaveLength(0)
  })

  it('«Solo resúmenes» no ofrece archivos', async () => {
    const { r, proj } = await projectRig()
    const f = join(proj, 'reporte.md')
    writeFileSync(f, 'x')
    r.svc.setSummariesOnly(true)
    await choose(r, 'Proyecto')
    startTurn(r, 's_code', 'Crea')
    finishTurn(r, 's_code', [toolPart('write', { filePath: f, content: 'x' }), textPart('Hecho.')])
    await until(() => r.tg.to(OWNER).some((x) => x.text.includes('Hecho.')))
    expect(buttons(lastMsg(r))).toHaveLength(0)
  })

  it('una sesión de Chat solo puede mandar archivos de la carpeta del chat', async () => {
    const { r, proj } = await projectRig()
    const f = join(proj, 'reporte.md')
    writeFileSync(f, 'x')
    r.engine.addSession({ id: 's_chat', title: 'Charla', kind: 'chat', directory: '/chat' })
    r.engine.addUser('s_chat', 'inicio')
    r.engine.addAssistant('s_chat', [textPart('listo')])
    await choose(r, 'Charla')
    startTurn(r, 's_chat', 'Crea')
    finishTurn(r, 's_chat', [toolPart('write', { filePath: f, content: 'x' }), textPart('Hecho.')])
    await until(() => r.tg.to(OWNER).some((x) => x.text.includes('Hecho.')))
    expect(buttons(lastMsg(r))).toHaveLength(0) // la carpeta del proyecto no es de esa sesión
  })
})

describe('archivos que manda el dueño', { retry: 2 }, () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

  async function writable(): Promise<Rig> {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await choose(r, 'Sesión A')
    return r
  }
  const sent = (r: Rig, n: number): Promise<void> => until(() => r.tg.to(OWNER).length > n, 3000, 'respuesta del bot')

  it('un archivo de texto espera y se adjunta al SIGUIENTE mensaje; un solo envío al motor', async () => {
    const r = await writable()
    const id = r.tg.uploadFile({ name: 'notas.txt', bytes: Buffer.from('apuntes de la reunión') })
    let n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: id, name: 'notas.txt', mime: 'text/plain' })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('Recibí «notas.txt»')
    expect(r.engine.prompts).toHaveLength(0)
    n = r.tg.to(OWNER).length
    r.tg.sendUser({ chatId: OWNER, text: 'Resume los apuntes' })
    await until(() => r.engine.prompts.length === 1)
    const p = r.engine.prompts[0]!
    expect(p.input.text).toBe('Resume los apuntes')
    expect(p.input.files).toHaveLength(1)
    expect(p.input.files[0]).toMatchObject({ mime: 'text/plain', filename: 'notas.txt' })
    expect(p.input.files[0]!.url.startsWith('data:text/plain;base64,')).toBe(true)
    expect(Buffer.from(p.input.files[0]!.url.split(',')[1]!, 'base64').toString()).toBe('apuntes de la reunión')
    // y ya no queda adjunto para el mensaje siguiente
    r.tg.sendUser({ chatId: OWNER, text: 'otro mensaje' })
    await until(() => r.engine.prompts.length === 2)
    expect(r.engine.prompts[1]!.input.files).toEqual([])
    const audit = readAudit(r.store.auditFile).find((a) => a.kind === 'file-received')!
    expect(audit).toMatchObject({ mode: 'chat', ext: 'txt', bytes: 22 })
    expect(JSON.stringify(audit)).not.toContain('notas')
  })

  it('una foto (imagen) se adjunta como imagen; con pie de foto el pie es el mensaje y se envía ya', async () => {
    const r = await writable()
    const id = r.tg.uploadFile({ name: 'foto.jpg', bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]) })
    r.tg.sendPhoto({ chatId: OWNER, fileId: id, caption: '¿Qué dice este cartel?' })
    await until(() => r.engine.prompts.length === 1)
    const p = r.engine.prompts[0]!
    expect(p.input.text).toBe('¿Qué dice este cartel?')
    expect(p.input.files[0]).toMatchObject({ mime: 'image/jpeg' })
  })

  it('una imagen PNG y un PDF pasan igual que los adjuntos normales', async () => {
    const r = await writable()
    const png = r.tg.uploadFile({ name: 'a.png', bytes: PNG })
    const pdf = r.tg.uploadFile({ name: 'a.pdf', bytes: Buffer.from('%PDF-1.4\nx') })
    r.tg.sendDocument({ chatId: OWNER, fileId: png, name: 'a.png', mime: 'image/png' })
    r.tg.sendDocument({ chatId: OWNER, fileId: pdf, name: 'a.pdf', mime: 'application/pdf' })
    await until(() => r.tg.to(OWNER).filter((m) => m.text.includes('Recibí')).length === 2)
    r.tg.sendUser({ chatId: OWNER, text: 'mira esto' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts[0]!.input.files.map((f) => f.mime)).toEqual(['image/png', 'application/pdf'])
  })

  it('rechazados con motivo: ejecutables, scripts, secretos, tipos raros, contenido que no coincide, vacíos', async () => {
    const r = await writable()
    const cases: [string, Buffer, string, string][] = [
      ['setup.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(50)]), 'application/x-msdownload', 'programas ni scripts'],
      ['hola.sh', Buffer.from('echo hola'), 'text/x-shellscript', 'programas ni scripts'],
      ['.env', Buffer.from('A=1'), 'text/plain', 'claves o datos secretos'],
      ['id_rsa', Buffer.from('x'), 'text/plain', 'claves o datos secretos'],
      ['cancion.mp3', Buffer.from('ID3'), 'audio/mpeg', 'ese tipo de archivo'],
      ['falsa.png', Buffer.from('no soy imagen'), 'image/png', 'no coincide'],
      ['vacio.txt', Buffer.alloc(0), 'text/plain', 'vacío']
    ]
    for (const [name, bytes, mime, why] of cases) {
      const id = r.tg.uploadFile({ name, bytes })
      const n = r.tg.to(OWNER).length
      r.tg.sendDocument({ chatId: OWNER, fileId: id, name, mime })
      await sent(r, n)
      expect(lastMsg(r)!.text, name).toContain(why)
    }
    r.tg.sendUser({ chatId: OWNER, text: 'ahora el mensaje' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts[0]!.input.files).toEqual([]) // nada rechazado quedó adjunto
    const refused = readAudit(r.store.auditFile).filter((a) => a.kind === 'file-refused')
    expect(refused.length).toBeGreaterThanOrEqual(6)
  })

  it('demasiado grande: se rechaza por el tamaño que dice Telegram SIN descargarlo; si miente, se rechaza al descargar', async () => {
    const r = await writable()
    const big = r.tg.uploadFile({ name: 'grande.txt', bytes: Buffer.from('x'), declaredSize: 11 * 1024 * 1024 })
    let n = r.tg.to(OWNER).length
    const downloads = (): number => r.tg.requests.filter((q) => q.method === 'download').length
    r.tg.sendDocument({ chatId: OWNER, fileId: big, name: 'grande.txt', mime: 'text/plain', size: 11 * 1024 * 1024 })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('demasiado grande')
    expect(downloads()).toBe(0)
    const liar = r.tg.uploadFile({ name: 'mentira.txt', bytes: Buffer.alloc(10 * 1024 * 1024 + 5, 0x61) })
    n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: liar, name: 'mentira.txt', mime: 'text/plain', size: 100 })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('demasiado grande')
    // un texto de más de 1 MB (tope del texto del Chat) también se rechaza
    const txt = r.tg.uploadFile({ name: 'largo.txt', bytes: Buffer.alloc(1024 * 1024 + 10, 0x61) })
    n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: txt, name: 'largo.txt', mime: 'text/plain' })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('demasiado grande')
  })

  it('Word se convierte a texto con la extracción existente y viaja como texto', async () => {
    const r = await writable()
    const JSZip = (await import('jszip')).default
    const z = new JSZip()
    z.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Presupuesto 2027</w:t></w:r></w:p></w:body></w:document>'
    )
    const id = r.tg.uploadFile({ name: 'presupuesto.docx', bytes: await z.generateAsync({ type: 'nodebuffer' }) })
    r.tg.sendDocument({
      chatId: OWNER,
      fileId: id,
      name: 'presupuesto.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      caption: 'Revísalo'
    })
    await until(() => r.engine.prompts.length === 1)
    const f = r.engine.prompts[0]!.input.files[0]!
    expect(f.mime).toBe('text/plain')
    expect(Buffer.from(f.url.split(',')[1]!, 'base64').toString()).toContain('Presupuesto 2027')
  })

  it('con «escribir» apagado o sin sesión, los archivos no se descargan', async () => {
    const r = await ready()
    seed(r)
    const id = r.tg.uploadFile({ name: 'a.txt', bytes: Buffer.from('x') })
    let n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: id, name: 'a.txt', mime: 'text/plain' })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('elige una conversación')
    await choose(r, 'Sesión A')
    n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: id, name: 'a.txt', mime: 'text/plain' })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('Permitir escribir')
    expect(r.tg.requests.filter((q) => q.method === 'download' || q.method === 'getFile')).toHaveLength(0)
  })

  it('un archivo de un chat ajeno se ignora sin responder', async () => {
    const r = await writable()
    const id = r.tg.uploadFile({ name: 'a.txt', bytes: Buffer.from('x') })
    const n = r.tg.messages.length
    r.tg.sendDocument({ chatId: 9001, fileId: id, name: 'a.txt', mime: 'text/plain' })
    await settle(400)
    expect(r.tg.messages.length).toBe(n)
    expect(r.tg.requests.filter((q) => q.method === 'getFile')).toHaveLength(0)
  })

  it('adjuntos pendientes: caducan, hay un tope, y apagar «escribir» los descarta', async () => {
    const r = await writable()
    const up = (name: string): string => r.tg.uploadFile({ name, bytes: Buffer.from('dato ' + name) })
    for (const nme of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      const n = r.tg.to(OWNER).length
      r.tg.sendDocument({ chatId: OWNER, fileId: up(nme), name: nme, mime: 'text/plain' })
      await sent(r, n)
    }
    expect(lastMsg(r)!.text).toContain('demasiados archivos')
    r.clock.now += 16 * 60_000
    r.tg.sendUser({ chatId: OWNER, text: 'ya pasó mucho' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts[0]!.input.files).toEqual([]) // caducaron
    const n = r.tg.to(OWNER).length
    r.tg.sendDocument({ chatId: OWNER, fileId: up('e.txt'), name: 'e.txt', mime: 'text/plain' })
    await sent(r, n)
    // La confirmación del bot sale un instante ANTES de que el adjunto quede pendiente: en un runner lento, apagar «escribir» enseguida
    // todavía no tenía nada que descartar y el adjunto llegaba al mensaje siguiente.
    await settle(400)
    r.svc.setAllowWrite(false)
    r.svc.setAllowWrite(true)
    r.clock.now += 61_000
    r.tg.sendUser({ chatId: OWNER, text: 'otra vez' })
    await until(() => r.engine.prompts.length === 2)
    expect(r.engine.prompts[1]!.input.files).toEqual([])
  })

  it('las notas de voz todavía no se usan: el bot lo dice y no toca el motor', async () => {
    const r = await writable()
    const id = r.tg.uploadFile({ name: 'voz.ogg', bytes: Buffer.from('OggS') })
    const n = r.tg.to(OWNER).length
    r.tg.sendVoice({ chatId: OWNER, fileId: id })
    await sent(r, n)
    expect(lastMsg(r)!.text).toContain('notas de voz')
    expect(r.engine.prompts).toHaveLength(0)
    expect(r.tg.requests.filter((q) => q.method === 'download' || q.method === 'getFile')).toHaveLength(0)
  })
})

describe('NADA llega a una sesión no elegida', { retry: 2 }, () => {
  it('con la sesión A elegida, los eventos, mensajes y archivos de la B no producen ni un mensaje y solo A recibe texto', async () => {
    const r = await ready()
    seed(r)
    r.svc.setAllowWrite(true)
    await choose(r, 'Sesión A')
    const n = r.tg.messages.length
    // Actividad completa en la sesión B (que no se eligió).
    startTurn(r, 's_b', 'trabajo de B')
    progress(r, 's_b', [toolPart('bash', { command: 'echo secreto de B' }, 'completed', { output: 'salida de B' })])
    finishTurn(r, 's_b', [textPart('respuesta de B que nadie pidió')])
    await settle(500)
    expect(r.tg.messages.length).toBe(n)
    expect(r.tg.edits.some((e) => e.text.includes('B'))).toBe(false)
    // Texto y archivos van solo a A.
    r.tg.sendUser({ chatId: OWNER, text: 'para A' })
    await until(() => r.engine.prompts.length === 1)
    expect(r.engine.prompts.every((p) => p.id === 's_a' && p.directory === '/chat')).toBe(true)
    // El bot tampoco leyó los mensajes de B.
    const reads = new Set<string>()
    const orig = r.engine.messages.bind(r.engine)
    r.engine.messages = async (d, id) => {
      reads.add(id)
      return orig(d, id)
    }
    startTurn(r, 's_b', 'más trabajo de B')
    finishTurn(r, 's_b', [textPart('otra respuesta de B')])
    await settle(400)
    expect(reads.has('s_b')).toBe(false)
  })

  it('el aviso «Terminó» de la entrega 1 sigue llegando para las sesiones que NO se siguen', async () => {
    const r = await ready({ limits: { minBusyForDoneMs: 0 } })
    seed(r)
    await choose(r, 'Sesión A')
    r.engine.emit({ kind: 'session-info', sessionID: 's_b', title: 'Sesión B', parentID: null })
    r.engine.emit({ kind: 'status', sessionID: 's_b', status: 'busy' })
    r.clock.now += 20_000
    r.engine.emit({ kind: 'status', sessionID: 's_b', status: 'idle' })
    await until(() => r.tg.to(OWNER).some((m) => m.text.startsWith('Terminó')))
  })

  it('«Detener todo ahora» corta el seguimiento: no se manda ni se edita nada más', async () => {
    const r = await ready()
    seed(r)
    await choose(r, 'Sesión A')
    startTurn(r, 's_a', 'Trabajo')
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' })])
    await until(() => live(r) !== undefined)
    r.svc.panic()
    const n = r.tg.messages.length
    const e = r.tg.edits.length
    progress(r, 's_a', [toolPart('read', { filePath: '/p/uno.ts' }), toolPart('read', { filePath: '/p/dos.ts' })])
    finishTurn(r, 's_a', [textPart('respuesta después del pánico')])
    await settle(500)
    expect(r.tg.messages.length).toBe(n)
    expect(r.tg.edits.length).toBe(e)
  })
})
