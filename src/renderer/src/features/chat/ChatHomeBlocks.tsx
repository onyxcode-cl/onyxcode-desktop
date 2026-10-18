/** Bloques del inicio de Chat para retomar conversaciones: «Respondiendo ahora» y «Retomar». Sin conversaciones no pintan nada. */
import { displayTitle } from '@shared/session-title'
import { useMemo } from 'react'
import { HomeAttentionCard, HomeResume, type HomeRow } from '../../components/HomeBlocks'
import { useT } from '../../lib/i18n'
import { selectSessionsForDirectory } from '../../lib/session-reducer'
import { useServer } from '../../stores/server'
import { useSessions } from '../../stores/sessions'
import { relTime } from '../tasks/impl/util'
import { useCompare, useHiddenCompareSession } from '../compare'
import { openChatSession } from './actions'
import { pickChatHome, type ChatHome, type ChatHomeItem } from './chat-home'

/** Conversaciones de Chat (las mismas que la barra lateral) separadas en «respondiendo ahora» y «recientes». */
export function useChatHome(): ChatHome {
  const connection = useServer((s) => s.connection)
  const allSessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const status = useSessions((s) => s.status)
  // Las sesiones de una comparación sin elegir no son conversaciones todavía.
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
  const busyIds = useMemo(
    () =>
      new Set(
        Object.entries(status)
          .filter(([, s]) => s !== 'idle')
          .map(([id]) => id)
      ),
    [status]
  )
  return useMemo(() => pickChatHome(sessions, busyIds), [sessions, busyIds])
}

export function ChatHomeBlocks({ home, part }: { home: ChatHome; part: 'working' | 'resume' }): React.JSX.Element | null {
  const t = useT()
  const open = (id: string): void => void openChatSession(id)
  const title = (i: ChatHomeItem): string => displayTitle(i.session.title, t('chat.newConversation'))
  if (part === 'working') {
    const rows: HomeRow[] = home.working.map((i) => ({
      id: i.session.id,
      title: title(i),
      state: 'working',
      meta: t('app.sidebar.working')
    }))
    return (
      <HomeAttentionCard
        titleId="chat-home-working-title"
        title={t('chat.home.working.title')}
        rows={rows}
        tone="accent"
        openLabel={t('chat.home.working.open')}
        openAria={(name) => t('chat.home.working.openAria', { title: name })}
        onOpen={open}
      />
    )
  }
  const rows: HomeRow[] = home.recent.map((i) => ({
    id: i.session.id,
    title: title(i),
    state: null,
    meta: t('chat.home.resume.done', { when: relTime(i.session.time.updated) })
  }))
  return <HomeResume titleId="chat-home-resume-title" title={t('chat.home.resume.title')} rows={rows} onOpen={open} />
}
