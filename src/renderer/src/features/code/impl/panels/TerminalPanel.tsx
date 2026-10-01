import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RotateCcw } from 'lucide-react'
import { useT } from '../../../../lib/i18n'
import { IconButton } from '../../../../components/IconButton'
import { errorMessage, requireCode } from '../client'

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function themeFromCss(): ITheme {
  return {
    background: cssVar('--bg-code', '#151412'),
    foreground: cssVar('--fg', '#ecebe6'),
    cursor: cssVar('--accent', '#2dd4bf'),
    cursorAccent: cssVar('--bg-code', '#151412'),
    selectionBackground: cssVar('--accent-soft', '#173a36')
  }
}

/**
 * Terminal integrada (xterm.js + node-pty en main). Se crea un pty por montaje; el
 * contenedor debe mantener el componente montado para conservar la sesión del shell.
 */
export function TerminalPanel({ directory, visible }: { directory: string; visible: boolean }): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<number | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let api: ReturnType<typeof requireCode>
    try {
      api = requireCode()
    } catch (err) {
      setError(errorMessage(err))
      return
    }
    const term = new Terminal({
      fontFamily: cssVar('--font-mono', "ui-monospace, 'SF Mono', Menlo, monospace"),
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      theme: themeFromCss()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fitRef.current = fit
    try {
      fit.fit()
    } catch {
      // contenedor sin tamaño aún
    }

    let ptyId: string | null = null
    let disposed = false
    const early = new Map<string, string[]>()
    const earlyExit = new Map<string, number>()

    const offData = api.onPtyData((ev) => {
      if (ptyId === null) {
        early.set(ev.id, [...(early.get(ev.id) ?? []), ev.data])
        return
      }
      if (ev.id === ptyId) term.write(ev.data)
    })
    const offExit = api.onPtyExit((ev) => {
      if (ptyId === null) earlyExit.set(ev.id, ev.exitCode)
      else if (ev.id === ptyId) setExited(ev.exitCode)
    })

    setError(null)
    setExited(null)
    api.pty
      .create({ cwd: directory, cols: term.cols, rows: term.rows })
      .then((info) => {
        if (disposed) {
          void api.pty.kill(info.id).catch(() => undefined)
          return
        }
        ptyId = info.id
        for (const chunk of early.get(info.id) ?? []) term.write(chunk)
        early.clear()
        // El shell puede haber terminado antes de que `create` resolviera: muestra el banner de salida.
        const code = earlyExit.get(info.id)
        if (code !== undefined) setExited(code)
        else void api.pty.resize(info.id, term.cols, term.rows).catch(() => undefined)
      })
      .catch((err: unknown) => {
        if (!disposed) setError(errorMessage(err))
      })

    const onInput = term.onData((data) => {
      if (ptyId) void api.pty.write(ptyId, data).catch(() => undefined)
    })
    const onResize = term.onResize(({ cols, rows }) => {
      if (ptyId) void api.pty.resize(ptyId, cols, rows).catch(() => undefined)
    })

    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        try {
          fit.fit()
        } catch {
          // ignorar
        }
      }
    })
    ro.observe(host)

    // Actualiza colores cuando cambia el tema de la app.
    const mo = new MutationObserver(() => {
      term.options.theme = themeFromCss()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    return () => {
      disposed = true
      ro.disconnect()
      mo.disconnect()
      onInput.dispose()
      onResize.dispose()
      offData()
      offExit()
      if (ptyId) void api.pty.kill(ptyId).catch(() => undefined)
      fitRef.current = null
      term.dispose()
    }
  }, [directory, generation])

  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // ignorar
      }
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  return (
    <div className="flex h-full min-h-0 flex-col bg-code">
      {(error || exited !== null) && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          <span className={error ? 'text-danger' : 'text-muted'}>
            {error ? t('code.terminal.openFailed', { error }) : t('code.terminal.exited', { code: exited ?? '' })}
          </span>
          <IconButton label={t('code.terminal.restart')} className="ml-auto h-6 w-6" onClick={() => setGeneration((g) => g + 1)}>
            <RotateCcw size={13} />
          </IconButton>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
    </div>
  )
}
