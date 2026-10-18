/** Recetas de Rutinas (F8-B188): tarjetas y diálogo con el detalle. Elegir una receta solo rellena «Nueva rutina»; no crea nada. */
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Clock,
  Dumbbell,
  FileText,
  Files,
  FolderOpen,
  GitBranch,
  GraduationCap,
  Inbox,
  ListChecks,
  Newspaper,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Telescope,
  Wallet,
  X,
  type LucideIcon
} from 'lucide-react'
import { getLang } from '@shared/i18n'
import {
  RECIPES,
  bi,
  buildRecipeInput,
  cleanAnswer,
  defaultAnswers,
  folderQuestion,
  missingAnswers,
  recipeById,
  textQuestions,
  type RecipeIcon,
  type RoutineRecipe
} from '@shared/routine-recipes'
import { Button } from '../../../components/Button'
import { DialogScrim } from '../../../components/Dialog'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { resolveModelForMode } from '../../settings/impl/extras'
import { MODE_META } from './meta'
import { scheduleText } from './schedule'
import { openEditor } from './store'

const ICONS: Record<RecipeIcon, LucideIcon> = {
  newspaper: Newspaper,
  'folder-open': FolderOpen,
  files: Files,
  inbox: Inbox,
  wallet: Wallet,
  'shopping-cart': ShoppingCart,
  'graduation-cap': GraduationCap,
  telescope: Telescope,
  dumbbell: Dumbbell,
  'git-branch': GitBranch,
  'scroll-text': ScrollText,
  'list-checks': ListChecks
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle desk:h-8 desk:rounded-ctl desk:border-border-strong desk:py-0 desk:text-sm desk:ring-0 desk:focus:shadow-focus'

/** Recetas que se ofrecen en esta plataforma (Overdrive solo donde existe). */
export function availableRecipes(): RoutineRecipe[] {
  return RECIPES.filter((r) => r.mode !== 'tasks' || platformCaps().tasks)
}

/** Cuándo se ejecuta, en una línea. */
export function recipeWhen(r: RoutineRecipe, t: ReturnType<typeof useT>): string {
  return r.schedule.kind === 'file' ? t('routines.recipes.whenFile', { max: r.schedule.maxPerHour }) : scheduleText(r.schedule)
}

/** Tarjeta de receta: abre el detalle (estado vacío e «Ideas para empezar»). */
export function RecipeCard({ recipe, onPick }: { recipe: RoutineRecipe; onPick?: (id: string) => void }): React.JSX.Element {
  const t = useT()
  const lang = getLang()
  const Icon = ICONS[recipe.icon] ?? FileText
  const ModeIcon = MODE_META[recipe.mode].icon
  return (
    <button
      type="button"
      data-testid={`recipe-${recipe.id}`}
      onClick={() => onPick?.(recipe.id)}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-elevated p-4 text-left transition hover:-translate-y-px hover:border-border-strong hover:shadow-md desk:rounded-card desk:border-transparent desk:shadow-sm desk:hover:translate-y-0 desk:hover:border-transparent desk:hover:bg-hover desk:hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-muted transition group-hover:bg-accent-soft group-hover:text-accent desk:rounded-ctl desk:bg-active desk:text-accent desk:group-hover:bg-active">
          <Icon size={16} aria-hidden />
        </span>
        <span className="flex items-center gap-1 text-[11px] desk:text-meta text-subtle">
          <ModeIcon size={11} aria-hidden /> {MODE_META[recipe.mode].label}
        </span>
      </div>
      <div className="text-sm font-medium">{bi(recipe.title, lang)}</div>
      <div className="text-xs leading-relaxed text-muted">{bi(recipe.description, lang)}</div>
      <div className="mt-auto flex items-center gap-1 pt-1 text-[11px] desk:text-meta text-subtle">
        <Clock size={11} aria-hidden /> {recipeWhen(recipe, t)}
      </div>
    </button>
  )
}

/** Rejilla de recetas agrupada por público (todos / quien programa). */
export function RecipeGrid({ onPick }: { onPick: (id: string) => void }): React.JSX.Element | null {
  const t = useT()
  const list = availableRecipes()
  if (list.length === 0) return null
  const groups = [
    { id: 'everyone', title: t('routines.recipes.groupEveryone'), items: list.filter((r) => r.audience === 'everyone') },
    { id: 'technical', title: t('routines.recipes.groupTechnical'), items: list.filter((r) => r.audience === 'technical') }
  ].filter((g) => g.items.length > 0)
  return (
    <div className="space-y-5 text-left">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`recipes-group-${g.id}`}>
          <h3 id={`recipes-group-${g.id}`} className="mb-2 px-1 text-xs font-semibold text-muted">
            {g.title}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((r) => (
              <RecipeCard key={r.id} recipe={r} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold text-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Detalle de una receta: qué hace y qué no, acceso, horario y preguntas. «Usar esta receta» abre el formulario prellenado. */
export function RecipeDetail({ recipe, onUse }: { recipe: RoutineRecipe; onUse: () => void }): React.JSX.Element {
  const t = useT()
  const lang = getLang()
  const baseId = useId()
  const [answers, setAnswers] = useState<Record<string, string>>(() => defaultAnswers(recipe, lang))
  const [touched, setTouched] = useState(false)
  const texts = textQuestions(recipe)
  const folder = folderQuestion(recipe)
  const missing = missingAnswers(recipe, answers)
  const ModeIcon = MODE_META[recipe.mode].icon
  const Icon = ICONS[recipe.icon] ?? FileText

  const use = (): void => {
    setTouched(true)
    if (missing.length > 0) return
    const input = buildRecipeInput(recipe, lang, answers, resolveModelForMode(recipe.mode))
    const title = bi(recipe.title, lang)
    openEditor(input, t(folder ? 'routines.recipes.editorHintFolder' : 'routines.recipes.editorHint', { title }))
    onUse()
  }

  return (
    <div data-testid="recipe-detail">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon size={19} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-muted">{bi(recipe.description, lang)}</p>
        </div>
      </div>

      <Section title={t('routines.recipes.does')}>
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-subtle">
          {recipe.does.map((d, i) => (
            <li key={i}>{bi(d, lang)}</li>
          ))}
        </ul>
      </Section>
      <Section title={t('routines.recipes.doesNot')}>
        <ul className="list-disc space-y-1 pl-5 text-sm marker:text-subtle">
          {recipe.doesNot.map((d, i) => (
            <li key={i}>{bi(d, lang)}</li>
          ))}
        </ul>
      </Section>
      <Section title={t('routines.recipes.access')}>
        <p className="flex items-start gap-1.5 text-sm">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden /> <span>{bi(recipe.access.text, lang)}</span>
        </p>
      </Section>
      <Section title={t('routines.recipes.data')}>
        <p className="text-sm">{bi(recipe.dataNote, lang)}</p>
      </Section>
      <Section title={t('routines.recipes.when')}>
        <p className="flex items-center gap-1.5 text-sm">
          <Clock size={14} className="shrink-0 text-muted" aria-hidden /> {recipeWhen(recipe, t)}
        </p>
      </Section>
      <Section title={t('routines.recipes.mode')}>
        <p className="flex items-center gap-1.5 text-sm">
          <ModeIcon size={14} className="shrink-0 text-muted" aria-hidden /> {MODE_META[recipe.mode].label}
          <span className="text-xs text-muted">· {MODE_META[recipe.mode].hint}</span>
        </p>
      </Section>

      {(folder || texts.length > 0) && (
        <Section title={t('routines.recipes.questions')}>
          <div className="space-y-3">
            {folder && (
              <div className="rounded-lg bg-hover px-3 py-2 text-sm">
                <div className="flex items-center gap-1.5 font-medium">
                  <FolderOpen size={14} className="shrink-0 text-muted" aria-hidden /> {bi(folder.label, lang)}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {bi(folder.help, lang)} {t('routines.recipes.folderStep')}
                </p>
              </div>
            )}
            {texts.map((q) => {
              const id = `${baseId}-${q.id}`
              const invalid = touched && q.required && cleanAnswer(answers[q.id] ?? '', q.maxLength) === ''
              return (
                <div key={q.id}>
                  <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
                    {bi(q.label, lang)}
                    {!q.required && <span className="ml-1 font-normal text-subtle">({t('routines.recipes.optional')})</span>}
                  </label>
                  <input
                    id={id}
                    className={`${inputCls} ${invalid ? 'border-danger/60' : ''}`}
                    value={answers[q.id] ?? ''}
                    maxLength={q.maxLength}
                    placeholder={bi(q.placeholder, lang)}
                    aria-invalid={invalid || undefined}
                    aria-describedby={q.help ? `${id}-help` : undefined}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        use()
                      }
                    }}
                  />
                  {q.help && (
                    <p id={`${id}-help`} className="mt-1 text-[11px] desk:text-meta text-subtle">
                      {bi(q.help, lang)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <p className="mt-4 text-xs text-subtle">{t('routines.recipes.tray')}</p>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        <span role="status" className="mr-auto text-xs text-danger">
          {touched && missing.length > 0 ? t('routines.recipes.missing', { items: missing.map((q) => bi(q.label, lang)).join(', ') }) : ''}
        </span>
        <span className="text-xs text-subtle">{t('routines.recipes.useHint')}</span>
        <Button variant="primary" onClick={use}>
          {t('routines.recipes.use')}
        </Button>
      </div>
    </div>
  )
}

/** Diálogo de recetas: lista todas y, al elegir una, muestra su detalle. `initialId` abre directo el detalle. */
export function RecipesDialog({ initialId, onClose }: { initialId?: string | null; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const lang = getLang()
  const titleId = useId()
  const [id, setId] = useState<string | null>(initialId ?? null)
  const recipe = useMemo(() => (id ? recipeById(id) : undefined), [id])
  const count = availableRecipes().length

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      if (id && !initialId) setId(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [id, initialId, onClose])

  return (
    <DialogScrim onDismiss={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="recipes-dialog"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-elevated shadow-2xl animate-rise-in desk:rounded-modal desk:border-transparent desk:shadow-modal"
      >
        <header className="flex shrink-0 items-start gap-2.5 px-5 pt-4 pb-3 desk:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold desk:text-[17px] desk:leading-6">
              {recipe ? bi(recipe.title, lang) : t('routines.recipes.title')}
            </h2>
            {!recipe && <p className="mt-0.5 text-xs text-muted">{t('routines.recipes.subtitle')}</p>}
            {!recipe && count > 0 && (
              <p className="mt-0.5 text-[11px] desk:text-meta text-subtle">{t('routines.recipes.count', { count })}</p>
            )}
            {recipe && !initialId && (
              <button type="button" onClick={() => setId(null)} className="mt-0.5 text-xs text-accent hover:underline">
                ← {t('routines.recipes.back')}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
            aria-label={t('routines.recipes.close')}
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 desk:px-6">
          {recipe ? (
            <RecipeDetail key={recipe.id} recipe={recipe} onUse={onClose} />
          ) : count > 0 ? (
            <RecipeGrid onPick={setId} />
          ) : (
            <p className="py-6 text-sm text-muted">{t('routines.recipes.empty')}</p>
          )}
        </div>
      </div>
    </DialogScrim>
  )
}
