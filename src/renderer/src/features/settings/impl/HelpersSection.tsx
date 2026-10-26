/**
 * Ajustes › Ayudantes: lista de los ayudantes de una carpeta (`GET /agent` vía main) y editor del `.md` de `.opencode/agents/`.
 *
 * Todo texto que viene de un archivo o del motor (nombre, descripción, herramientas…) se pinta como TEXTO PLANO en nodos de texto de React
 * (nunca Markdown, nunca `dangerouslySetInnerHTML`, nunca enlaces): `parseHelperList` ya le quitó controles y marcas de dirección.
 * La escritura la hace main: solo dentro de la carpeta elegida, con el nombre validado y sin seguir enlaces (`main/ipc/helper-agents.ts`).
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { t as tr, type MsgKey } from '@shared/i18n'
import {
  checkHelperName,
  HELPER_LIMITS,
  validateHelperDef,
  type HelperDef,
  type HelperOrigin,
  type HelperSaveResult,
  type HelperView
} from '@shared/helper-agents'
import { Button } from '../../../components/Button'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useSettings } from '../../../stores/settings'
import { Badge, Card, ErrorText, Field, Row, SectionHeader, Select, TextArea, TextInput, Toggle } from './ui'

const FOLDER_KEY = 'settings.helpers.folder'

function loadFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY)
  } catch {
    return null
  }
}
function saveFolder(dir: string | null): void {
  try {
    if (dir) localStorage.setItem(FOLDER_KEY, dir)
    else localStorage.removeItem(FOLDER_KEY)
  } catch {
    // sin storage
  }
}

const EMPTY_DEF: HelperDef = {
  name: '',
  description: '',
  prompt: '',
  model: 'inherit',
  allowedTools: [],
  disallowedTools: [],
  maxTurns: null,
  background: false,
  skills: null
}

const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0)

const ORIGIN_KEY: Record<HelperOrigin, MsgKey> = {
  opencode: 'settings.helpers.origin.opencode',
  claude: 'settings.helpers.origin.claude',
  native: 'settings.helpers.origin.native',
  other: 'settings.helpers.origin.other'
}

function modelLabel(model: string): string {
  if (model === 'small') return tr('settings.helpers.model.small')
  if (model === 'inherit') return tr('settings.helpers.model.inherit')
  return model
}

/** Mensaje legible del resultado de guardar. */
function saveError(r: Extract<HelperSaveResult, { ok: false }>): string {
  switch (r.reason) {
    case 'name':
      return tr('settings.helpers.err.name')
    case 'reserved':
      return tr('settings.helpers.err.reserved')
    case 'exists':
      return tr('settings.helpers.err.exists')
    case 'invalid':
      return tr('settings.helpers.err.invalid', {
        field: r.field ? tr(`settings.helpers.field.${r.field}` as MsgKey) : ''
      })
    case 'folder':
      return tr('settings.helpers.err.folder')
    case 'link':
      return tr('settings.helpers.err.link')
    case 'complex':
      return tr('settings.helpers.err.complex', { keys: '' })
    case 'format':
      return tr('settings.helpers.err.format')
    case 'missing':
      return tr('settings.helpers.err.missing')
    default:
      return tr('settings.helpers.err.io')
  }
}

function HelperRow({ h, onEdit }: { h: HelperView; onEdit: () => void }): React.JSX.Element {
  const t = useT()
  const tools = (list: string[], emptyKey: MsgKey): string => (list.length > 0 ? list.join(', ') : t(emptyKey))
  return (
    <Row
      label={
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-all">{h.name}</span>
          <Badge tone={h.origin === 'native' ? 'muted' : 'accent'}>{t(ORIGIN_KEY[h.origin])}</Badge>
          {h.pending && <Badge tone="muted">{t('settings.helpers.pending')}</Badge>}
        </span>
      }
      description={
        <span className="block space-y-0.5">
          {h.description && <span className="block whitespace-pre-wrap break-words">{h.description}</span>}
          <span className="block">
            {t('settings.helpers.row.model')}: {modelLabel(h.model)}
          </span>
          <span className="block">
            {t('settings.helpers.row.allowed')}:{' '}
            {h.whitelist ? tools(h.allowedTools, 'settings.helpers.tools.none') : t('settings.helpers.tools.session')}
          </span>
          {h.blockedTools.length > 0 && (
            <span className="block">
              {t('settings.helpers.row.blocked')}: {h.blockedTools.join(', ')}
            </span>
          )}
          <span className="block">
            {t('settings.helpers.row.turns')}: {h.maxTurns ?? t('settings.helpers.turns.none')}
          </span>
          {h.background && (
            <span className="block">
              {t('settings.helpers.row.background')}: {t('settings.helpers.yes')}
            </span>
          )}
          {h.skills && (
            <span className="block">
              {t('settings.helpers.row.skills')}: {h.skills.length > 0 ? h.skills.join(', ') : t('settings.helpers.tools.none')}
            </span>
          )}
          {!h.editable && h.origin === 'claude' && <span className="block italic">{t('settings.helpers.readonly.claude')}</span>}
          {!h.editable && h.origin === 'other' && <span className="block italic">{t('settings.helpers.readonly.other')}</span>}
        </span>
      }
    >
      {h.editable && (
        <Button size="sm" variant="secondary" onClick={onEdit}>
          {t('settings.helpers.edit')}
        </Button>
      )}
    </Row>
  )
}

function HelperForm({
  folder,
  initial,
  mode,
  onClose,
  onSaved
}: {
  folder: string
  initial: HelperDef
  mode: 'create' | 'edit'
  onClose: () => void
  onSaved: (name: string) => void
}): React.JSX.Element {
  const t = useT()
  const id = useId()
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [prompt, setPrompt] = useState(initial.prompt)
  const known = initial.model === 'small' || initial.model === 'inherit'
  const [modelKind, setModelKind] = useState<'small' | 'inherit' | 'custom'>(known ? (initial.model as 'small' | 'inherit') : 'custom')
  const [modelId, setModelId] = useState(known ? '' : initial.model)
  const [allowed, setAllowed] = useState(initial.allowedTools.join(', '))
  const [blocked, setBlocked] = useState(initial.disallowedTools.join(', '))
  const [turns, setTurns] = useState(initial.maxTurns === null ? '' : String(initial.maxTurns))
  const [background, setBackground] = useState(initial.background)
  const [limitSkills, setLimitSkills] = useState(initial.skills !== null)
  const [skills, setSkills] = useState((initial.skills ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const build = (): HelperDef => ({
    name: name.trim(),
    description: description.replace(/\s*\n\s*/g, ' ').trim(),
    prompt,
    model: modelKind === 'custom' ? modelId.trim() : modelKind,
    allowedTools: splitList(allowed),
    disallowedTools: splitList(blocked),
    maxTurns: turns.trim() === '' ? null : Number(turns.trim()),
    background,
    skills: limitSkills ? splitList(skills) : null
  })

  const save = async (): Promise<void> => {
    if (busy) return
    const def = build()
    const nameCheck = checkHelperName(def.name)
    if (!nameCheck.ok)
      return setError(nameCheck.reason === 'reserved' ? t('settings.helpers.err.reserved') : t('settings.helpers.err.name'))
    const valid = validateHelperDef(def)
    if (!valid.ok) return setError(t('settings.helpers.err.invalid', { field: t(`settings.helpers.field.${valid.field}` as MsgKey) }))
    setBusy(true)
    setError(null)
    try {
      const r = await call('helpers:save', { directory: folder, def, mode })
      if (r.ok) onSaved(def.name)
      else setError(saveError(r))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-labelledby={`${id}-t`}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h3 id={`${id}-t`} className="text-sm font-semibold">
        {mode === 'create' ? t('settings.helpers.form.titleNew') : t('settings.helpers.form.titleEdit', { name: initial.name })}
      </h3>
      <Field label={t('settings.helpers.form.name')} hint={t('settings.helpers.form.nameHint')}>
        <TextInput
          autoFocus={mode === 'create'}
          value={name}
          disabled={mode === 'edit'}
          maxLength={HELPER_LIMITS.name}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('settings.helpers.form.description')} hint={t('settings.helpers.form.descriptionHint')}>
        <TextInput value={description} maxLength={HELPER_LIMITS.description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t('settings.helpers.form.prompt')}>
        <TextArea rows={8} value={prompt} maxLength={HELPER_LIMITS.prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <Field label={t('settings.helpers.form.model')}>
        <Select value={modelKind} onChange={(e) => setModelKind(e.target.value as 'small' | 'inherit' | 'custom')}>
          <option value="inherit">{t('settings.helpers.form.model.inherit')}</option>
          <option value="small">{t('settings.helpers.form.model.small')}</option>
          <option value="custom">{t('settings.helpers.form.model.custom')}</option>
        </Select>
      </Field>
      {modelKind === 'custom' && (
        <Field label={t('settings.helpers.form.modelId')} hint={t('settings.helpers.form.modelIdHint')}>
          <TextInput value={modelId} maxLength={HELPER_LIMITS.model} spellCheck={false} onChange={(e) => setModelId(e.target.value)} />
        </Field>
      )}
      <Field label={t('settings.helpers.form.allowed')} hint={t('settings.helpers.form.allowedHint')}>
        <TextInput value={allowed} spellCheck={false} autoCapitalize="off" autoCorrect="off" onChange={(e) => setAllowed(e.target.value)} />
      </Field>
      <Field label={t('settings.helpers.form.blocked')} hint={t('settings.helpers.form.blockedHint')}>
        <TextInput value={blocked} spellCheck={false} onChange={(e) => setBlocked(e.target.value)} />
      </Field>
      <Field label={t('settings.helpers.form.turns')} hint={t('settings.helpers.form.turnsHint')}>
        <TextInput inputMode="numeric" value={turns} maxLength={4} onChange={(e) => setTurns(e.target.value.replace(/[^0-9]/g, ''))} />
      </Field>
      <Card>
        <Row label={t('settings.helpers.form.background')}>
          <Toggle checked={background} onChange={setBackground} label={t('settings.helpers.form.background')} />
        </Row>
        <Row label={t('settings.helpers.form.skillsLimit')}>
          <Toggle checked={limitSkills} onChange={setLimitSkills} label={t('settings.helpers.form.skillsLimit')} />
        </Row>
      </Card>
      {limitSkills && (
        <Field label={t('settings.helpers.form.skills')} hint={t('settings.helpers.form.skillsHint')}>
          <TextInput value={skills} spellCheck={false} onChange={(e) => setSkills(e.target.value)} />
        </Field>
      )}
      <p role="note" className="text-xs leading-relaxed text-muted">
        {t('settings.helpers.limit')}
      </p>
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          {t('settings.helpers.form.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          {t('settings.helpers.form.cancel')}
        </Button>
      </div>
    </form>
  )
}

type View = { kind: 'list' } | { kind: 'form'; mode: 'create' | 'edit'; def: HelperDef }

export function HelpersSection(): React.JSX.Element {
  const t = useT()
  const recent = useSettings((s) => s.settings.recentFolders)
  const [folder, setFolder] = useState<string | null>(loadFolder)
  const [helpers, setHelpers] = useState<HelperView[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [tick, setTick] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  const choose = useCallback((dir: string | null) => {
    setFolder(dir)
    saveFolder(dir)
    setHelpers(null)
    setLoadError(null)
    setView({ kind: 'list' })
    setNote(null)
  }, [])

  useEffect(() => {
    if (!folder) return
    let alive = true
    setLoadError(null)
    call('helpers:list', { directory: folder })
      .then((r) => {
        if (!alive) return
        setAvailable(r.available)
        setHelpers(r.available ? r.helpers : [])
      })
      .catch((err: unknown) => {
        if (!alive) return
        setHelpers([])
        setLoadError(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [folder, tick])

  const pick = async (): Promise<void> => {
    try {
      const dir = await call('helpers:pickFolder')
      if (dir) choose(dir)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  const edit = async (name: string): Promise<void> => {
    if (!folder) return
    setReadError(null)
    try {
      const r = await call('helpers:read', { directory: folder, name })
      if (r.ok) setView({ kind: 'form', mode: 'edit', def: r.def })
      else if (r.reason === 'complex') setReadError(tr('settings.helpers.err.complex', { keys: (r.complex ?? []).join(', ') }))
      else if (r.reason === 'too_big') setReadError(tr('settings.helpers.err.tooBig'))
      else if (r.reason === 'format') setReadError(tr('settings.helpers.err.format'))
      else if (r.reason === 'folder') setReadError(tr('settings.helpers.err.folder'))
      else setReadError(tr('settings.helpers.err.missing'))
    } catch (err) {
      setReadError(errorMessage(err))
    }
  }

  const recentOptions = recent.slice(0, 20)

  return (
    <div>
      <SectionHeader title={t('settings.helpers.title')} description={t('settings.helpers.intro')} />
      <p role="note" className="mb-4 rounded-md border border-border px-3 py-2 text-xs font-medium leading-relaxed">
        {t('settings.helpers.limit')}
      </p>

      <Card className="mb-6">
        <Row label={t('settings.helpers.folder.label')} description={folder ?? t('settings.helpers.folder.none')} layout="stack-narrow">
          <div className="flex flex-wrap items-center gap-2">
            {recentOptions.length > 0 && (
              <Select
                aria-label={t('settings.helpers.folder.recent')}
                value=""
                onChange={(e) => e.target.value && choose(e.target.value)}
                className="max-w-[16rem]"
              >
                <option value="">{t('settings.helpers.folder.recent')}</option>
                {recentOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" variant="secondary" onClick={() => void pick()}>
              {t('settings.helpers.folder.choose')}
            </Button>
          </div>
        </Row>
      </Card>

      {folder && view.kind === 'list' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => setView({ kind: 'form', mode: 'create', def: EMPTY_DEF })}>
              {t('settings.helpers.new')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTick((n) => n + 1)}>
              {t('settings.helpers.refresh')}
            </Button>
          </div>
          {note && (
            <p role="status" className="mb-3 text-xs text-success">
              {note}
            </p>
          )}
          {loadError && (
            <div role="alert" className="mb-3">
              <ErrorText>{t('settings.helpers.loadFailed', { detail: loadError })}</ErrorText>
            </div>
          )}
          {readError && (
            <div role="alert" className="mb-3">
              <ErrorText>{readError}</ErrorText>
            </div>
          )}
          {helpers === null && !loadError && <p className="text-sm text-muted">{t('settings.helpers.loading')}</p>}
          {helpers !== null && !available && <p className="text-sm text-muted">{t('settings.helpers.unavailable')}</p>}
          {helpers !== null && available && helpers.length === 0 && !loadError && (
            <p className="text-sm text-muted">{t('settings.helpers.empty')}</p>
          )}
          {helpers !== null && helpers.length > 0 && (
            <Card>
              <ul>
                {helpers.map((h) => (
                  <li key={h.name}>
                    <HelperRow h={h} onEdit={() => void edit(h.name)} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">{t('settings.helpers.refreshHint')}</p>
        </>
      )}

      {folder && view.kind === 'form' && (
        <HelperForm
          folder={folder}
          initial={view.def}
          mode={view.mode}
          onClose={() => setView({ kind: 'list' })}
          onSaved={(name) => {
            setNote(`${t('settings.helpers.form.saved', { path: `.opencode/agents/${name}.md` })}. ${t('settings.helpers.refreshHint')}`)
            setView({ kind: 'list' })
            setTick((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
