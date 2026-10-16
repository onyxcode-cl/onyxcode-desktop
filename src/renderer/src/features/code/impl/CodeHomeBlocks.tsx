/** Bloques del inicio de Code para retomar sesiones: «Esperando tu aprobación» y «Retomar». Sin sesiones no pintan nada. */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { HomeAttentionCard, HomeResume, type HomeRow } from '../../../components/HomeBlocks'
import { useT } from '../../../lib/i18n'
import { displayTitle } from './session-title'
import { pickCodeHome, waitingRoots, type CodeHome, type CodeHomeItem } from './code-home'
import { deriveSessionState, sessionNeedsReview } from './review-logic'
import { rootSessionID, selectProjectSessions, useCode } from './store'
import { timeAgo } from './ui'

/** Sesiones del proyecto con el mismo estado que pinta la barra lateral (esperando, trabajando, por revisar, lista). */
export function useCodeHome(directory: string): CodeHome {
  const { sessions, sessionProject, permissions, questions, runState, unread, reviewed, reviewedSince } = useCode(
    useShallow((s) => ({
      sessions: s.sessions,
      sessionProject: s.sessionProject,
      permissions: s.permissions,
      questions: s.questions,
      runState: s.runState,
      unread: s.unread,
      reviewed: s.reviewed,
      reviewedSince: s.reviewedSince
    }))
  )
  return useMemo(() => {
    const waiting = waitingRoots(permissions, questions, (id) => rootSessionID(sessions, id))
    return pickCodeHome(selectProjectSessions({ sessions, sessionProject }, directory), (x) => {
      const run = runState[x.id]
      return deriveSessionState({
        waiting: waiting.has(x.id),
        busy: run === 'busy' || run === 'retry',
        unread: !!unread[x.id],
        needsReview: sessionNeedsReview(x.summary, reviewed[x.id], { updated: x.time.updated, since: reviewedSince })
      })
    })
  }, [sessions, sessionProject, permissions, questions, runState, unread, reviewed, reviewedSince, directory])
}

export function CodeHomeBlocks({ home, part }: { home: CodeHome; part: 'waiting' | 'resume' }): React.JSX.Element | null {
  const t = useT()
  const open = (id: string): void => void useCode.getState().selectSession(id)
  const title = (i: CodeHomeItem): string => displayTitle(i.session.title, t('code.sessions.untitled'))
  if (part === 'waiting') {
    const rows: HomeRow[] = home.waiting.map((i) => ({
      id: i.session.id,
      title: title(i),
      state: 'waiting',
      meta: t('code.home.waiting.meta')
    }))
    const more = home.waitingTotal - home.waiting.length
    return (
      <HomeAttentionCard
        titleId="code-home-waiting-title"
        title={t('code.home.waiting.title')}
        rows={rows}
        tone="warning"
        openLabel={t('code.home.waiting.open')}
        openAria={(name) => t('code.home.waiting.openAria', { title: name })}
        moreText={more > 0 ? t('code.home.waiting.more', { n: more }) : undefined}
        onOpen={open}
      />
    )
  }
  const rows: HomeRow[] = home.recent.map((i) => {
    const when = timeAgo(i.session.time.updated)
    return {
      id: i.session.id,
      title: title(i),
      state: i.state,
      meta:
        i.state === 'working'
          ? t('app.sidebar.working')
          : i.state === 'review'
            ? t('code.home.resume.review', { when })
            : t('code.home.resume.done', { when })
    }
  })
  return <HomeResume titleId="code-home-resume-title" title={t('code.home.resume.title')} rows={rows} onOpen={open} />
}
