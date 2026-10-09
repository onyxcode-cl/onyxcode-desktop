/**
 * Ajustes › Diagnóstico › «Estado del sistema»: lo que `doctor:run` dice que funciona y qué falta, con los arreglos que ya existen
 * (permisos de macOS, LibreOffice con su mismo consentimiento y el comando de las herramientas de Apple). Todo el diagnóstico vive en
 * main; aquí solo se muestra y se piden acciones. `doctorController` es la lógica sin DOM que se prueba aparte.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Info, RefreshCw, X } from 'lucide-react'
import type { MsgKey, Params } from '@shared/i18n'
import type { DoctorFix, DoctorId, DoctorItem, DoctorLevel, DoctorReport } from '@shared/doctor'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { cw } from '../../tasks/impl/bridge'
import { requestOfficeInstall, type OfficeInstallOutcome } from './OfficeComponentCard'
import { Badge, Card, ErrorText, SubTitle } from './ui'

type T = (key: MsgKey, params?: Params) => string

/** Comando de las herramientas de línea de comandos de Apple (lo ejecuta el usuario en Terminal; la app no lo lanza). */
export const XCODE_COMMAND = 'xcode-select --install'

/** Ids que se pueden revisar otra vez; `screens` y `disk` son los únicos que muestran su `detail` como texto principal. */
const DETAIL_AS_TEXT: ReadonlySet<DoctorId> = new Set<DoctorId>(['screens', 'disk'])

const OVERALL_TONE = { ok: 'ok', warn: 'warn', fail: 'error' } as const satisfies Record<DoctorReport['overall'], 'ok' | 'warn' | 'error'>

const OVERALL_KEY = {
  ok: 'settings.doctor.overall.ok',
  warn: 'settings.doctor.overall.warn',
  fail: 'settings.doctor.overall.fail'
} as const satisfies Record<DoctorReport['overall'], MsgKey>

const LEVEL_LABEL = {
  ok: 'settings.doctor.level.ok',
  warn: 'settings.doctor.level.warn',
  fail: 'settings.doctor.level.fail',
  info: 'settings.doctor.level.info'
} as const satisfies Record<DoctorLevel, MsgKey>

const LEVEL_ICON = { ok: Check, warn: AlertTriangle, fail: X, info: Info } as const
const LEVEL_TONE = { ok: 'text-success', warn: 'text-warning', fail: 'text-danger', info: 'text-muted' } as const

const TITLE_KEY = {
  macos: 'settings.doctor.item.macos.title',
  accessibility: 'settings.doctor.item.accessibility.title',
  screenRecording: 'settings.doctor.item.screenRecording.title',
  controlHelper: 'settings.doctor.item.controlHelper.title',
  keyboardTool: 'settings.doctor.item.keyboardTool.title',
  python: 'settings.doctor.item.python.title',
  office: 'settings.doctor.item.office.title',
  git: 'settings.doctor.item.git.title',
  disk: 'settings.doctor.item.disk.title',
  screens: 'settings.doctor.item.screens.title'
} as const satisfies Record<DoctorId, MsgKey>

/** Explicación corta por id y nivel. Si no hay clave para la combinación, el ítem se muestra sin explicación. */
const EXPLAIN_KEY: Partial<Record<DoctorId, Partial<Record<DoctorLevel, MsgKey>>>> = {
  macos: { ok: 'settings.doctor.item.macos.ok', fail: 'settings.doctor.item.macos.fail' },
  accessibility: { ok: 'settings.doctor.item.accessibility.ok', fail: 'settings.doctor.item.accessibility.fail' },
  screenRecording: { ok: 'settings.doctor.item.screenRecording.ok', fail: 'settings.doctor.item.screenRecording.fail' },
  controlHelper: { ok: 'settings.doctor.item.controlHelper.ok', fail: 'settings.doctor.item.controlHelper.fail' },
  keyboardTool: { ok: 'settings.doctor.item.keyboardTool.ok', warn: 'settings.doctor.item.keyboardTool.warn' },
  python: { ok: 'settings.doctor.item.python.ok', warn: 'settings.doctor.item.python.warn', fail: 'settings.doctor.item.python.fail' },
  office: { ok: 'settings.doctor.item.office.ok', warn: 'settings.doctor.item.office.warn' },
  git: { ok: 'settings.doctor.item.git.ok', warn: 'settings.doctor.item.git.warn' },
  disk: { ok: 'settings.doctor.item.disk.ok', warn: 'settings.doctor.item.disk.warn' }
}

/** Acciones que llaman a un canal existente (`xcodeSelect` no llama a nada: copia el comando). */
export type DoctorFixAction = Exclude<DoctorFix, 'xcodeSelect'>

export interface DoctorApi {
  run: () => Promise<DoctorReport>
  requestPermissions: () => Promise<void>
  installOffice: () => Promise<OfficeInstallOutcome>
}

/**
 * Acciones de la tarjeta. «Dar permisos» pide los permisos de macOS y luego vuelve a revisar; «Instalar LibreOffice» pasa por el
 * mismo flujo y consentimiento de la tarjeta de LibreOffice y luego revisa.
 */
export function doctorController(api: DoctorApi) {
  return {
    run: () => api.run(),
    async grantPermissions(): Promise<DoctorReport> {
      await api.requestPermissions()
      return api.run()
    },
    async installOffice(): Promise<DoctorReport> {
      await api.installOffice()
      return api.run()
    }
  }
}

/** «Copiar» del comando de `xcode-select`: solo escribe en el portapapeles, no ejecuta nada. */
export function copyXcodeCommand(write: (text: string) => Promise<void>): Promise<void> {
  return write(XCODE_COMMAND)
}

/** Canales reales que no necesitan React. La instalación de LibreOffice se añade en el componente (necesita `t`). */
const CHANNELS = {
  run: (): Promise<DoctorReport> => cw('doctor:run'),
  requestPermissions: (): Promise<void> => cw('computer:requestPermissions')
}

export interface DoctorCardViewProps {
  t: T
  report: DoctorReport | null
  /** Hay una revisión en curso (o un arreglo que termina con una revisión). */
  checking: boolean
  /** La última revisión falló (el canal no respondió). */
  error: boolean
  /** Arreglo en curso, para deshabilitar los demás y marcar el botón. */
  fixing: DoctorFixAction | null
  /** Se copió el comando de `xcode-select`. */
  copied: boolean
  onRerun: () => void
  onFix: (fix: DoctorFixAction) => void
  onCopy: () => void
}

function ItemRow({
  t,
  item,
  fixing,
  copied,
  onFix,
  onCopy
}: {
  t: T
  item: DoctorItem
  fixing: DoctorFixAction | null
  copied: boolean
  onFix: (fix: DoctorFixAction) => void
  onCopy: () => void
}): React.JSX.Element {
  const Icon = LEVEL_ICON[item.level]
  const explainKey = EXPLAIN_KEY[item.id]?.[item.level]
  const showDetailAsText = DETAIL_AS_TEXT.has(item.id)

  let control: React.JSX.Element | null = null
  if (item.fix === 'requestPermissions') {
    control = (
      <Button
        size="sm"
        variant="secondary"
        disabled={fixing !== null}
        loading={fixing === 'requestPermissions'}
        onClick={() => onFix('requestPermissions')}
      >
        {t('settings.doctor.fix.requestPermissions')}
      </Button>
    )
  } else if (item.fix === 'installOffice') {
    control = (
      <Button
        size="sm"
        variant="primary"
        disabled={fixing !== null}
        loading={fixing === 'installOffice'}
        onClick={() => onFix('installOffice')}
      >
        {t('settings.doctor.fix.installOffice')}
      </Button>
    )
  }

  return (
    <li className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span role="img" aria-label={t(LEVEL_LABEL[item.level])} className={`mt-0.5 shrink-0 ${LEVEL_TONE[item.level]}`}>
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t(TITLE_KEY[item.id])}</div>
        {explainKey && <div className="mt-0.5 text-xs text-muted">{t(explainKey)}</div>}
        {item.detail && (
          <div className={showDetailAsText ? 'mt-1 text-sm whitespace-pre-line' : 'mt-0.5 text-[11px] text-subtle'}>{item.detail}</div>
        )}
        {item.fix === 'xcodeSelect' && (
          <div className="mt-2 space-y-1.5">
            <div className="text-xs text-muted">{t('settings.doctor.xcode.hint')}</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border bg-bg px-2 py-1 font-mono text-[11px] text-fg">{XCODE_COMMAND}</code>
              <Button size="sm" variant="secondary" onClick={onCopy}>
                <Copy size={14} /> {copied ? t('settings.doctor.xcode.copied') : t('settings.doctor.xcode.copy')}
              </Button>
            </div>
          </div>
        )}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </li>
  )
}

/** Vista pura de la tarjeta. */
export function DoctorCardView({
  t,
  report,
  checking,
  error,
  fixing,
  copied,
  onRerun,
  onFix,
  onCopy
}: DoctorCardViewProps): React.JSX.Element {
  return (
    <>
      <SubTitle>{t('settings.doctor.title')}</SubTitle>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 text-sm" aria-live="polite">
            {checking ? (
              <span className="text-muted">{t('settings.doctor.checking')}</span>
            ) : report ? (
              <Badge tone={OVERALL_TONE[report.overall]}>{t(OVERALL_KEY[report.overall])}</Badge>
            ) : null}
          </div>
          <Button size="sm" variant="secondary" disabled={checking} loading={checking} onClick={onRerun}>
            {!checking && <RefreshCw size={14} />} {t('settings.doctor.rerun')}
          </Button>
        </div>

        {error && !checking && (
          <div className="space-y-2 px-4 py-3">
            <div role="alert">
              <ErrorText>{t('settings.doctor.error')}</ErrorText>
            </div>
            <Button size="sm" variant="secondary" onClick={onRerun}>
              {t('settings.doctor.retry')}
            </Button>
          </div>
        )}

        {report && !error && (
          <ul aria-label={t('settings.doctor.title')}>
            {report.items.map((item) => (
              <ItemRow key={item.id} t={t} item={item} fixing={fixing} copied={copied} onFix={onFix} onCopy={onCopy} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

/** Tarjeta conectada a IPC: revisa al abrir, con el botón y tras cada arreglo. */
export function DoctorCard(): React.JSX.Element {
  const t = useT()
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(false)
  const [fixing, setFixing] = useState<DoctorFixAction | null>(null)
  const [copied, setCopied] = useState(false)
  const alive = useRef(true)

  /** Ejecuta una revisión (o una acción seguida de revisión) y refleja el resultado. `t` no entra aquí a propósito. */
  const runCheck = useCallback(async (job: () => Promise<DoctorReport>): Promise<void> => {
    setChecking(true)
    setError(false)
    try {
      const r = await job()
      if (alive.current) setReport(r)
    } catch {
      if (alive.current) {
        setReport(null)
        setError(true)
      }
    } finally {
      if (alive.current) setChecking(false)
    }
  }, [])

  // Efecto sin dependencias de `t` (useT devuelve una función nueva en cada render): solo revisa al montar.
  useEffect(() => {
    alive.current = true
    void runCheck(CHANNELS.run)
    return () => {
      alive.current = false
    }
  }, [runCheck])

  const onRerun = (): void => void runCheck(CHANNELS.run)

  const onFix = (fix: DoctorFixAction): void => {
    if (fixing) return
    setFixing(fix)
    const ctl = doctorController({ ...CHANNELS, installOffice: () => requestOfficeInstall(t) })
    const job = fix === 'requestPermissions' ? () => ctl.grantPermissions() : () => ctl.installOffice()
    void runCheck(job).finally(() => {
      if (alive.current) setFixing(null)
    })
  }

  const onCopy = (): void => {
    setCopied(false)
    void copyXcodeCommand((text) => navigator.clipboard.writeText(text))
      .then(() => {
        if (alive.current) setCopied(true)
      })
      .catch(() => undefined)
  }

  return (
    <DoctorCardView
      t={t}
      report={report}
      checking={checking}
      error={error}
      fixing={fixing}
      copied={copied}
      onRerun={onRerun}
      onFix={onFix}
      onCopy={onCopy}
    />
  )
}
