import { useCallback, useEffect, useMemo } from 'react'
import { useT } from '../../lib/i18n'
import { ChatSessionList } from './ChatSessionList'
import { onStreamReconnect, useServer } from '../../stores/server'
import { sessionsKey, useSessions } from '../../stores/sessions'
import { selectSessionsForDirectory } from '../../lib/session-reducer'
import { deleteChat, loadChatSessions, openChatSession, renameChat, syncChatRunStatus } from './actions'
import { useCompare, useHiddenCompareSession } from '../compare'
import { useChat } from './store'

export function ChatSidebar(): React.JSX.Element {
  const t = useT()
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const status = useSessions((s) => s.status)
  const more = useSessions((s) => (connection ? s.moreSessions[sessionsKey(connection.chatDirectory)] : false))
  const client = useServer((s) => s.client)
  const { activeSessionId, listLoading, listError } = useChat()

  useEffect(() => {
    if (!connection) return
    void loadChatSessions()
    return onStreamReconnect(() => {
      // Primero la lista y después el estado (F7-B10): así las sesiones que el servidor ya no conoce no dejan `busy`.
      void loadChatSessions().then(() => syncChatRunStatus()) // limpia spinners de sesiones cuyo evento de fin se perdió (F6-B5)
    })
  }, [connection])

  // Las sesiones de una comparación sin elegir no son conversaciones todavía: no salen en la lista.
  const hidden = useHiddenCompareSession()
  const manifestsKey = useCompare((s) => s.manifests)
  const compareLoaded = useCompare((s) => s.loaded)
  const sessions = useMemo(
    () =>
      connection
        ? selectSessionsForDirectory({ sessions: allSessions, sessionSource, directorySource }, connection.chatDirectory).filter(
            (s) => !hidden(s)
          )
        : [],
    // `hidden` cambia con los manifiestos y la carga: se enumeran para no recalcular en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allSessions, sessionSource, directorySource, connection, manifestsKey, compareLoaded]
  )
  const onLoadMore = useCallback(
    (all: boolean) => {
      if (client && connection) void useSessions.getState().loadMoreSessions(client, connection.chatDirectory, undefined, all)
    },
    [client, connection]
  )
  const busyIds = useMemo(
    () =>
      new Set(
        Object.entries(status)
          .filter(([, s]) => s !== 'idle')
          .map(([id]) => id)
      ),
    [status]
  )

  return (
    <>
      {listError && <div className="px-3 py-2 text-xs text-danger">{listError}</div>}
      <ChatSessionList
        sessions={sessions}
        activeId={activeSessionId}
        busyIds={busyIds}
        loading={listLoading || !connection}
        emptyText={t('chat.sidebar.empty')}
        onSelect={(id) => void openChatSession(id)}
        onRename={renameChat}
        onDelete={deleteChat}
        hasMore={!!more}
        onLoadMore={onLoadMore}
        showTime
      />
    </>
  )
}
