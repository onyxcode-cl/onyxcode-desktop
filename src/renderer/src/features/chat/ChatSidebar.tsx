import { useEffect, useMemo } from 'react'
import { useT } from '../../lib/i18n'
import { ChatSessionList } from './ChatSessionList'
import { onStreamReconnect, useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { selectSessionsForDirectory } from '../../lib/session-reducer'
import { deleteChat, loadChatSessions, openChatSession, renameChat, syncChatRunStatus } from './actions'
import { useChat } from './store'

export function ChatSidebar(): React.JSX.Element {
  const t = useT()
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const status = useSessions((s) => s.status)
  const { activeSessionId, listLoading, listError } = useChat()

  useEffect(() => {
    if (!connection) return
    void loadChatSessions()
    return onStreamReconnect(() => {
      // Primero la lista y después el estado (F7-B10): así las sesiones que el servidor ya no conoce no dejan `busy`.
      void loadChatSessions().then(() => syncChatRunStatus()) // limpia spinners de sesiones cuyo evento de fin se perdió (F6-B5)
    })
  }, [connection])

  const sessions = useMemo(
    () =>
      connection ? selectSessionsForDirectory({ sessions: allSessions, sessionSource, directorySource }, connection.chatDirectory) : [],
    [allSessions, sessionSource, directorySource, connection]
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
      />
    </>
  )
}
