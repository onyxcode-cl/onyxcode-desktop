/**
 * Conexión del tablero «Ayudantes» con el almacén de Code. Todo se calcula con lo que ya llegó por los eventos del motor (sin sondeo);
 * solo «Ver» (leer los mensajes de la hija) y «Detener» piden algo al motor, y solo si la carpeta tiene el foco y la confianza vigente
 * verificada en esta ejecución (`canQueryFolder`): pedir con `directory=` carga la carpeta en el motor.
 */
import { useCallback, useMemo } from 'react'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { useCode, rootSessionID } from './store'
import { sdkData, useClient } from './client'
import { useNow } from './BackgroundJobs'
import { HelpersBoard, type HelperLine } from './HelpersBoard'
import { canQueryFolder, selectHelperBoard } from './helpers-board'
import { isFolderVerified } from './verified-folders'

const MAX_TEXT = 4000

/** Texto plano de un mensaje: sus partes de texto (sin las sintéticas) y los nombres de las herramientas que usó. */
export function toHelperLine(m: { info: unknown; parts: Part[] }): HelperLine {
  const info = (m.info && typeof m.info === 'object' ? m.info : {}) as { id?: unknown; role?: unknown }
  const text = m.parts
    .filter((p) => p.type === 'text' && !(p as { synthetic?: boolean }).synthetic)
    .map((p) => (p as { text: string }).text)
    .join('\n')
    .trim()
  const tools = m.parts.filter((p) => p.type === 'tool').map((p) => String((p as { tool?: unknown }).tool ?? ''))
  return {
    id: typeof info.id === 'string' ? info.id : String(Math.random()),
    role: info.role === 'user' ? 'user' : 'assistant',
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    tools: tools.filter(Boolean)
  }
}

export function CodeHelpersBoard(): React.JSX.Element | null {
  const client = useClient()
  const activeSessionID = useCode((s) => s.activeSessionID)
  const sessions = useCode((s) => s.sessions)
  const sessionProject = useCode((s) => s.sessionProject)
  const status = useCode((s) => s.runState)
  const messages = useCode((s) => s.messages)
  const errors = useCode((s) => s.errors)
  const permissions = useCode((s) => s.permissions)
  const questions = useCode((s) => s.questions)
  const elicitations = useCode((s) => s.elicitations)
  const directory = useCode((s) => s.directory)
  const isTrusted = useCode((s) => s.isTrusted)

  const rootId = activeSessionID ? rootSessionID(sessions, activeSessionID) : null
  const pending = useMemo(
    () => [...Object.values(permissions), ...Object.values(questions), ...Object.values(elicitations)].map((p) => p.sessionID),
    [permissions, questions, elicitations]
  )
  const input = { rootId, sessions, status, messages, errors, pendingSessionIds: pending }
  const probe = selectHelperBoard({ ...input, now: Date.now() })
  const now = useNow(probe.liveCount > 0) // el reloj solo corre mientras algún ayudante trabaja
  const board = probe.liveCount > 0 ? selectHelperBoard({ ...input, now }) : probe

  const rootDir = rootId ? (sessionProject[rootId] ?? sessions[rootId]?.directory) : undefined
  const canAct = !!client && canQueryFolder(rootDir, { directory, isTrusted }, isFolderVerified)

  /** Carpeta de un ayudante, solo si hay permiso de pedirle algo al motor; si no, lanza (nunca se pide). */
  const dirFor = (id: string): string => {
    const dir = sessionProject[id] ?? rootDir
    const st = useCode.getState()
    if (!client || !dir || !canQueryFolder(dir, { directory: st.directory, isTrusted: st.isTrusted }, isFolderVerified)) {
      throw new Error('no-focus')
    }
    return dir
  }

  const stop = async (id: string): Promise<void> => {
    sdkData(await client!.session.abort({ sessionID: id, directory: dirFor(id) }))
  }
  const stopAll = async (): Promise<void> => {
    const live = board.rows.filter((r) => r.live).map((r) => r.id)
    const res = await Promise.allSettled(live.map((id) => stop(id)))
    if (res.some((r) => r.status === 'rejected')) throw new Error('stop-all')
  }
  const loadConversation = useCallback(
    async (id: string): Promise<HelperLine[]> => {
      const st = useCode.getState()
      const dir = st.sessionProject[id] ?? (rootId ? st.sessionProject[rootId] : undefined)
      if (!client || !dir || !canQueryFolder(dir, { directory: st.directory, isTrusted: st.isTrusted }, isFolderVerified)) {
        throw new Error('no-focus')
      }
      const data = sdkData(await client.session.messages({ sessionID: id, directory: dir }))
      return data.map(toHelperLine)
    },
    [client, rootId]
  )
  // Cambia con cada mensaje o parte nueva del ayudante: el almacén ya recibe esos eventos, no hace falta preguntar por tiempo.
  const version = (id: string): string => {
    const list = messages[id] ?? []
    return `${list.length}:${list[list.length - 1]?.parts.length ?? 0}:${status[id] ?? ''}`
  }

  return (
    <HelpersBoard
      board={board}
      canAct={canAct}
      onStop={stop}
      onStopAll={stopAll}
      onLoadConversation={loadConversation}
      conversationVersion={version}
    />
  )
}
