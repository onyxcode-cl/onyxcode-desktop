/**
 * Lo que la persona debe saber de un conector LOCAL antes de instalarlo (F8-B186): es un programa de un tercero que se instala y se
 * ejecuta en su equipo. Se muestra igual en el detalle de la ficha y en el primer paso del asistente. Todo sale de la ficha
 * empaquetada (`runtime`); nada se afirma que no sea cierto (el aislamiento, en concreto, se dice tal cual: no hay).
 */
import { AlertTriangle, Check, Download, FolderCog, ShieldAlert } from 'lucide-react'
import type { CatalogLocalConnector } from '@shared/catalogo'
import { buildLocalEntry, localPermissions } from '@shared/local-connector'
import { useT } from '../../lib/i18n'

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Datos del programa: autor, licencia, versión fijada, de dónde se descarga, tamaño y qué se comprueba. */
export function LocalFacts({ item }: { item: CatalogLocalConnector }): React.JSX.Element {
  const t = useT()
  const rt = item.runtime
  return (
    <div data-testid="pers-local-facts" className="space-y-3 text-sm">
      <ul className="space-y-1.5">
        <li className="flex items-start gap-2">
          <Download size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('pers.local.fact.program', { author: rt.author, license: rt.license, version: rt.version })}</span>
        </li>
        <li className="flex items-start gap-2">
          <Check size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <span>{t('pers.local.fact.source', { host: hostOf(rt.sourceUrl) })}</span>
        </li>
        <li className="flex items-start gap-2">
          <Download size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('pers.local.fact.download', { hosts: rt.downloadFrom.join(', '), mb: rt.approxMB })}</span>
        </li>
        <li className="flex items-start gap-2">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <span>{t('pers.local.fact.verify')}</span>
        </li>
        <li className="flex items-start gap-2">
          <FolderCog size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('pers.local.fact.where')}</span>
        </li>
        <li className="flex items-start gap-2">
          <FolderCog size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
          <span>{t('pers.local.fact.token', { dir: rt.tokenDir })}</span>
        </li>
      </ul>
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-warning">
          <AlertTriangle size={15} aria-hidden="true" /> {t('pers.local.sandboxTitle')}
        </p>
        <p className="mt-1.5 leading-relaxed">{t('pers.local.sandbox')}</p>
      </div>
    </div>
  )
}

/** Lista exacta de herramientas: cuáles se pueden usar y cuáles quedan desactivadas. */
export function LocalTools({ item }: { item: CatalogLocalConnector }): React.JSX.Element {
  const t = useT()
  const tools = item.runtime.tools
  return (
    <details data-testid="pers-local-tools" className="text-xs text-muted">
      <summary className="cursor-pointer text-sm text-fg">
        {t('pers.local.toolsSummary', { allowed: tools.allowed.length, blocked: tools.blocked.length })}
      </summary>
      <p className="mt-2 font-semibold text-fg">{t('pers.local.toolsAllowed')}</p>
      <p className="mt-1 font-mono leading-relaxed break-words">{tools.allowed.join(' · ')}</p>
      {tools.auth.length > 0 && <p className="mt-1.5">{t('pers.local.toolsAuth', { list: tools.auth.join(', ') })}</p>}
      <p className="mt-3 font-semibold text-fg">{t('pers.local.toolsBlocked')}</p>
      <p className="mt-1 font-mono leading-relaxed break-words">{tools.blocked.join(' · ')}</p>
    </details>
  )
}

/** JSON exacto que se guardará, con la carpeta y el programa de Node como marcadores (se conocen al instalar). */
export function previewLocalJson(item: CatalogLocalConnector, name: string, askEachUse: boolean): string {
  const dir = `<lazunox-data>/conectores-locales/${name}`
  const entry = buildLocalEntry(item, dir, item.runtime.manager === 'npm' ? '<node>' : null)
  return JSON.stringify({ mcp: { [name]: entry }, permission: localPermissions(name, item, askEachUse) }, null, 2)
}
