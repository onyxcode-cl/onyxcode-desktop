import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Hammer, ListChecks, Square } from 'lucide-react'
import type { ModelRef } from '@shared/types'
import { useProviders } from '../../../stores/providers'
import { useSettings } from '../../../stores/settings'
import { useClient } from './client'
import { useCode } from './store'
import type { CodeAgent } from './types'

function AgentToggle({ value, onChange }: { value: CodeAgent; onChange: (a: CodeAgent) => void }): React.JSX.Element {
  const opts: { id: CodeAgent; label: string; icon: React.JSX.Element; hint: string }[] = [
    { id: 'plan', label: 'Plan', icon: <ListChecks size={13} />, hint: 'Planifica sin modificar archivos' },
    { id: 'build', label: 'Build', icon: <Hammer size={13} />, hint: 'Edita archivos y ejecuta comandos' }
  ]
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${value === o.id ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ModelSelect({ value, onChange }: { value: ModelRef; onChange: (m: ModelRef) => void }): React.JSX.Element {
  const client = useClient()
  const providers = useProviders((s) => s.providers)
  const load = useProviders((s) => s.load)
  useEffect(() => {
    if (client) void load(client)
  }, [client, load])

  const current = `${value.providerID}/${value.modelID}`
  const hasCurrent = providers.some((p) => p.id === value.providerID && value.modelID in p.models)
  return (
    <select
      value={current}
      onChange={(e) => {
        const [providerID, ...rest] = e.target.value.split('/')
        onChange({ providerID, modelID: rest.join('/') })
      }}
      title="Modelo"
      className="max-w-56 truncate rounded-lg border border-border bg-bg px-2 py-1 text-xs text-muted outline-none hover:text-fg focus:border-accent"
    >
      {!hasCurrent && <option value={current}>{value.modelID}</option>}
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {Object.values(p.models).map((m) => (
            <option key={m.id} value={`${p.id}/${m.id}`}>
              {m.name || m.id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export function Composer({ busy, disabled }: { busy: boolean; disabled?: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const agent = useCode((s) => s.agent)
  const setAgent = useCode((s) => s.setAgent)
  const model = useCode((s) => s.model)
  const setModel = useCode((s) => s.setModel)
  const send = useCode((s) => s.send)
  const abort = useCode((s) => s.abort)
  const defaultModel = useSettings((s) => s.settings.defaultModel)
  const effectiveModel = model ?? defaultModel

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  const submit = (): void => {
    if (!text.trim() || busy || disabled) return
    if (!model) setModel(defaultModel)
    const t = text
    setText('')
    void send(t)
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-4">
      <div className="rounded-2xl border border-border bg-elevated shadow-sm focus-within:border-border-strong">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault()
              setAgent(agent === 'plan' ? 'build' : 'plan')
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={agent === 'plan' ? 'Describe qué quieres planificar…' : 'Pide un cambio en el código…'}
          className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] outline-none placeholder:text-subtle"
        />
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <AgentToggle value={agent} onChange={setAgent} />
          <ModelSelect value={effectiveModel} onChange={setModel} />
          <span className="ml-auto" />
          {busy ? (
            <button
              type="button"
              onClick={() => void abort()}
              title="Detener"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg hover:opacity-85"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim() || disabled}
              title="Enviar (Enter)"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 text-center text-[11px] text-subtle">Mayús+Tab alterna Plan / Build · Mayús+Enter nueva línea</div>
    </div>
  )
}
