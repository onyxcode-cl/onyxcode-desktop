import { useEffect, useMemo } from 'react'
import { SessionList } from '../../components/SessionList'
import { onStreamReconnect, useServer } from '../../stores/server'
import { selectSessionsForDirectory, useSessions } from '../../stores/sessions'
import { deleteChat, loadChatSessions, openChatSession, renameChat } from './actions'
import { useChat } from './store'

export function ChatSidebar(): React.JSX.Element {
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const status = useSessions((s) => s.status)
  const { activeSessionId, listLoading, listError } = useChat()

  useEffect(() => {
    if (!connection) return
    void loadChatSessions()
    return onStreamReconnect(() => void loadChatSessions())
  }, [connection])

  const sessions = useMemo(
    () => (connection ? selectSessionsForDirectory(allSessions, connection.chatDirectory) : []),
    [allSessions, connection]
  )
  const busyIds = useMemo(
    () => new Set(Object.entries(status).filter(([, s]) => s !== 'idle').map(([id]) => id)),
    [status]
  )

  return (
    <>
      {listError && <div className="px-3 py-2 text-xs text-danger">{listError}</div>}
      <SessionList
        sessions={sessions}
        activeId={activeSessionId}
        busyIds={busyIds}
        loading={listLoading || !connection}
        emptyText="Aún no hay conversaciones"
        onSelect={(id) => void openChatSession(id)}
        onRename={renameChat}
        onDelete={deleteChat}
      />
    </>
  )
}
