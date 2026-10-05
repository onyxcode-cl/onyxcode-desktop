import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListChecks, RefreshCw } from 'lucide-react'
import { stripDesk } from '../../../../../test/strip-desk'

import { Section } from './PanelSection'

describe('sección del panel de Progreso (render estático, sin desk:)', () => {
  it('abierta con insignia y cuerpo', () => {
    const html = renderToStaticMarkup(
      <Section icon={ListChecks} title="Plan" badge="2/5" defaultOpen>
        <p>contenido</p>
      </Section>
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<section class="border-b border-border last:border-b-0"><header class="flex items-center gap-2 px-4 py-2.5"><button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right shrink-0 text-subtle transition-transform rotate-90" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-checks shrink-0 text-muted" aria-hidden="true"><path d="M13 5h8"></path><path d="M13 12h8"></path><path d="M13 19h8"></path><path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path></svg><span>Plan</span><span class="rounded-full bg-hover px-1.5 text-[11px] font-medium text-muted">2/5</span></button></header><div class="px-4 pb-3.5"><p>contenido</p></div></section>"`
    )
  })

  it('cerrada', () => {
    const html = renderToStaticMarkup(
      <Section icon={ListChecks} title="Contexto" defaultOpen={false}>
        <p>oculto</p>
      </Section>
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<section class="border-b border-border last:border-b-0"><header class="flex items-center gap-2 px-4 py-2.5"><button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right shrink-0 text-subtle transition-transform" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-checks shrink-0 text-muted" aria-hidden="true"><path d="M13 5h8"></path><path d="M13 12h8"></path><path d="M13 19h8"></path><path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path></svg><span>Contexto</span></button></header></section>"`
    )
  })

  it('con acción a la derecha', () => {
    const html = renderToStaticMarkup(
      <Section
        icon={ListChecks}
        title="Entregables"
        defaultOpen
        right={
          <button type="button" className="rounded p-1 text-subtle hover:bg-hover hover:text-fg">
            <RefreshCw size={12} />
          </button>
        }
      >
        <p>cuerpo</p>
      </Section>
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(
      `"<section class="border-b border-border last:border-b-0"><header class="flex items-center gap-2 px-4 py-2.5"><button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-semibold"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right shrink-0 text-subtle transition-transform rotate-90" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-list-checks shrink-0 text-muted" aria-hidden="true"><path d="M13 5h8"></path><path d="M13 12h8"></path><path d="M13 19h8"></path><path d="m3 17 2 2 4-4"></path><path d="m3 7 2 2 4-4"></path></svg><span>Entregables</span></button><button type="button" class="rounded p-1 text-subtle hover:bg-hover hover:text-fg"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg></button></header><div class="px-4 pb-3.5"><p>cuerpo</p></div></section>"`
    )
  })
})
