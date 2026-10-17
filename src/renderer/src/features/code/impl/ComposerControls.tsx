/**
 * Controles de la barra inferior del compositor de Code (estilo de los clientes de escritorio de referencia):
 * carpeta del proyecto, modo de permisos, selector de modelo (con el esfuerzo como submenú) y medidor de uso.
 * Los menús se abren hacia arriba porque el compositor vive al fondo de la ventana.
 */
import { useDismiss } from '../../../lib/use-dismiss'
import { useEffect, useState } from 'react'
import {
  AtSign,
  CircleSlash,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Hammer,
  ListChecks,
  MoreHorizontal,
  Paperclip,
  PencilLine,
  Shield,
  Wand2
} from 'lucide-react'
import type { MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface, isWindowsPlatform, platformCaps } from '../../../lib/platform'
import { baseName, tildify } from '../../../lib/paths'
import { ChipMenu, type ChipMenuOption } from '../../../components/ChipMenu'
import { ModelPicker } from '../../../components/ModelPicker'
import { UsageMeter } from '../../../components/UsageMeter'
import { useAiGate, type AiGate } from '../../../lib/ai-gate'
import { useModeModel } from '../../settings/impl/extras'
import { CompareControls } from '../../compare'
import { useCode } from './store'
import { nativeCode } from './client'
import { sameDir } from './open-projects'
import { pickAndOpenFolder } from './ProjectPicker'
import { useVisibleFsVersion } from './useVisibleFsVersion'
import type { PermissionMode } from './types'

const PERMISSION_MODES: { id: PermissionMode; label: MsgKey; hint: MsgKey; short: MsgKey; icon: React.JSX.Element }[] = [
  { id: 'manual', label: 'code.mode.manual', hint: 'code.mode.manual.hint', short: 'code.mode.manual.short', icon: <Shield size={14} /> },
  {
    id: 'acceptEdits',
    label: 'code.mode.acceptEdits',
    hint: 'code.mode.acceptEdits.hint',
    short: 'code.mode.acceptEdits.short',
    icon: <PencilLine size={14} />
  },
  { id: 'plan', label: 'code.mode.plan', hint: 'code.mode.plan.hint', short: 'code.mode.plan.short', icon: <ListChecks size={14} /> },
  { id: 'auto', label: 'code.mode.auto', hint: 'code.mode.auto.hint', short: 'code.mode.auto.short', icon: <Wand2 size={14} /> },
  {
    id: 'bypass',
    label: 'code.mode.bypass',
    hint: 'code.mode.bypass.hint',
    short: 'code.mode.bypass.short',
    icon: <CircleSlash size={14} />
  }
]

/** Modelo pedido (el elegido en Code o el predeterminado) resuelto contra las IA conectadas. */
export function useCodeAiGate(): AiGate {
  const model = useCode((s) => s.model)
  const modeModel = useModeModel('code')
  return useAiGate(model ?? modeModel)
}

/** Modo de permisos de la sesión activa: chip siempre visible; si no cabe la etiqueta completa queda la corta («Preguntar», «Auto»…); `aria-label`/`title` llevan siempre «ajuste: valor». */
export function PermissionChip(): React.JSX.Element {
  const t = useT()
  const mode = useCode((s) => s.permissionMode)
  const current = PERMISSION_MODES.find((m) => m.id === mode) ?? PERMISSION_MODES[0]
  // El motor lee las reglas de la sesión al EMPEZAR cada respuesta: con una en curso, el cambio vale desde el próximo mensaje.
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(false), 6000)
    return () => clearTimeout(id)
  }, [notice])
  const pick = (id: string): void => {
    const st = useCode.getState()
    const running = st.activeSessionID ? st.runState[st.activeSessionID] === 'busy' : false
    setNotice(running)
    void st.setPermissionMode(id as PermissionMode)
  }
  return (
    <ChipMenu
      name={t('code.mode.title')}
      valueLabel={t(current.label)}
      icon={current.icon}
      value={mode}
      tone={mode === 'bypass' ? 'danger' : undefined}
      collapseClass="inline desk:@max-[30rem]:sr-only"
      shortClass="hidden desk:@max-[30rem]:inline"
      testId="permission-chip"
      note={t('code.mode.note')}
      notice={notice ? t('code.mode.laterNotice') : undefined}
      options={PERMISSION_MODES.map((m) => ({
        id: m.id,
        label: t(m.label),
        hint: t(m.hint),
        shortLabel: t(m.short),
        icon: m.icon,
        tone: m.id === 'bypass' ? 'danger' : undefined
      }))}
      onSelect={pick}
    />
  )
}

/** Build / Plan del agente: chip con menú (qué hace cada uno) y el atajo ⇧Tab en el `title`. */
export function AgentChip({ agent, onChange }: { agent: 'build' | 'plan'; onChange: (a: 'build' | 'plan') => void }): React.JSX.Element {
  const t = useT()
  return (
    <ChipMenu
      name={t('code.agent.title')}
      valueLabel={agent === 'plan' ? t('code.agent.plan') : t('code.agent.build')}
      icon={agent === 'plan' ? <ListChecks size={14} /> : <Hammer size={14} />}
      value={agent}
      tone={agent === 'plan' ? 'accent' : undefined}
      collapseClass="inline desk:@max-[26rem]:sr-only"
      chevronClass="block desk:@max-[26rem]:hidden"
      chipShortcut={isWindowsPlatform() ? 'Shift+Tab' : '⇧Tab'}
      testId="agent-chip"
      options={[
        { id: 'build', label: t('code.agent.build'), hint: t('code.agent.build.hint'), icon: <Hammer size={14} /> },
        { id: 'plan', label: t('code.agent.plan'), hint: t('code.agent.plan.hint'), icon: <ListChecks size={14} /> }
      ]}
      onSelect={(id) => onChange(id as 'build' | 'plan')}
    />
  )
}

/** Rama de la carpeta (se refresca cuando cambian archivos). `undefined` mientras carga o si no es un repositorio. */
function useFolderBranch(dir: string | null): string | undefined {
  const fsVersion = useVisibleFsVersion()
  const [branch, setBranch] = useState<string | undefined>(undefined)
  useEffect(() => {
    setBranch(undefined)
    const native = nativeCode()
    if (!dir || !native) return
    let cancelled = false
    void native.git
      .currentBranch(dir)
      .then((b) => !cancelled && setBranch(b ?? undefined))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [dir, fsVersion])
  return branch
}

/**
 * Carpeta EFECTIVA de ESTA sesión (la de la sesión abierta, que puede ser un worktree distinto del proyecto con foco) y su rama.
 * La cabecera ya tiene el menú del proyecto con foco (pasa, cierra, recientes…); este chip aporta lo que ve la caja: DÓNDE va a
 * trabajar el mensaje que se está escribiendo, y cambia de proyecto abierto, agrega otro o abre la carpeta en el explorador.
 * Solo escritorio (en el celular hay un solo proyecto y la barra no tiene sitio).
 */
export function ProjectChip(): React.JSX.Element | null {
  const t = useT()
  const directory = useCode((s) => s.directory)
  const sessionDir = useCode((s) => (s.activeSessionID ? s.sessions[s.activeSessionID]?.directory : undefined))
  const openDirectories = useCode((s) => s.openDirectories)
  const effective = sessionDir || directory
  const branch = useFolderBranch(effective)
  if (isRemoteSurface() || !effective) return null
  const native = nativeCode('dialogs')
  const dialogs = platformCaps().nativeDialogs
  const projects = openDirectories.some((d) => sameDir(d, effective)) ? openDirectories : [effective, ...openDirectories]
  const options: ChipMenuOption[] = [
    ...projects.map((d) => ({ id: d, label: baseName(d), hint: tildify(d), icon: <FolderOpen size={14} aria-hidden /> })),
    {
      id: '__add',
      label: t('code.chip.project.add'),
      icon: <FolderPlus size={14} aria-hidden />,
      action: true,
      separatorBefore: true
    },
    ...(native && dialogs
      ? [{ id: '__reveal', label: t('code.menu.reveal'), icon: <FolderSearch size={14} aria-hidden />, action: true }]
      : [])
  ]
  const current = projects.find((d) => sameDir(d, effective)) ?? effective
  const onSelect = (id: string): void => {
    if (id === '__add') void (dialogs ? pickAndOpenFolder() : useCode.getState().showProjectPicker())
    else if (id === '__reveal') void native?.dialog.revealInFinder(effective)
    else void useCode.getState().focusProject(id)
  }
  return (
    <ChipMenu
      name={t('code.chip.project.title')}
      valueLabel={baseName(effective)}
      detail={branch ? `${t('code.chip.project.branch')} ${branch}` : undefined}
      detailClass="hidden desk:@min-[56rem]:inline desk:max-w-[9rem] truncate"
      labelClass="truncate"
      icon={<FolderOpen size={14} className="shrink-0" aria-hidden />}
      options={options}
      value={current}
      collapseClass="inline desk:@max-[44rem]:sr-only"
      chevronClass="block desk:@max-[44rem]:hidden"
      className="min-w-0 shrink desk:max-w-[13rem]"
      testId="project-chip"
      onSelect={onSelect}
    />
  )
}

/** Grupo derecho de la barra: modelo (con su esfuerzo en el submenú) · uso. */
export function ModelControls(): React.JSX.Element {
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const activeSessionID = useCode((s) => s.activeSessionID)
  const messages = useCode((s) => (activeSessionID ? s.messages[activeSessionID] : undefined))
  const modeModel = useModeModel('code')
  const gate = useCodeAiGate()
  const effective = gate.effective ?? model ?? modeModel
  const directory = useCode((s) => s.directory)
  const variant = useCode((s) => s.variant)
  const setVariant = useCode((s) => s.setVariant)

  return (
    <div className="flex items-center gap-0.5 desk:ml-auto desk:min-w-0 desk:shrink">
      {/* «Comparar modelos…»: solo el ícono, y solo con sitio (en la barra de escritorio). No existe en el celular. */}
      <div className="block desk:@max-[36rem]:hidden">
        <CompareControls mode="code" directory={directory} current={effective} variant={variant} align="right" iconOnly />
      </div>
      {/* El nombre largo se acorta con «…» (nunca se sale ni se pisa con lo de al lado); el menú se alinea a la derecha. */}
      <div className="no-drag desk:max-w-[15rem] desk:min-w-[5.5rem] desk:shrink [&_.absolute]:right-0 [&_.absolute]:left-auto [&_.absolute]:origin-bottom-right">
        <ModelPicker value={effective} onChange={setModel} placement="top" effort={{ variant, onChange: setVariant }} />
      </div>
      <div className="block desk:@max-[30rem]:hidden">
        <UsageMeter messages={messages ?? []} model={effective} />
      </div>
    </div>
  )
}

/** «⋯» de la barra de escritorio: solo aparece cuando el compositor es muy angosto y reúne lo que no guarda estado (mencionar, adjuntar). */
export function ComposerMoreMenu({ onMention, onAttach }: { onMention: () => void; onAttach: () => void }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium hover:bg-hover'
  return (
    <div ref={ref} className="relative hidden desk:@max-[24rem]:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('code.composer.more')}
        aria-label={t('code.composer.more')}
        className={`no-drag flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg ${open ? 'bg-hover text-fg' : ''}`}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-52 animate-pop-in origin-bottom-left rounded-xl border border-border bg-elevated p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false)
              onMention()
            }}
          >
            <AtSign size={14} /> {t('code.composer.mention')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false)
              onAttach()
            }}
          >
            <Paperclip size={14} /> {t('code.composer.attach')}
          </button>
        </div>
      )}
    </div>
  )
}
