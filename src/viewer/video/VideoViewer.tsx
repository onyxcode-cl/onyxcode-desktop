import { useState } from 'react'
import { docUrl } from '../params'
import { tv, type ViewerLang } from '../i18n'

export function VideoViewer({ token, lang }: { token: string; lang: ViewerLang }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  return (
    <div className="viewer-center" style={{ height: '100vh', background: '#111' }}>
      {failed ? (
        <p role="alert">{tv(lang, 'videoFailed')}</p>
      ) : (
        <video
          src={docUrl(token)}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={tv(lang, 'videoLabel')}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      )}
    </div>
  )
}
