import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReasoningPart } from '@opencode-ai/sdk/v2/client'
import { Reasoning } from './Reasoning'

const part = { id: 'p', type: 'reasoning', text: 'pienso', time: { start: 1, end: 2 } } as unknown as ReasoningPart

describe('Reasoning', () => {
  it.each(['chat', 'code'] as const)('variante %s: el botón anuncia aria-expanded', (variant) => {
    const html = renderToStaticMarkup(createElement(Reasoning, { part, live: false, variant }))
    expect(html).toContain('aria-expanded="false"')
  })
})
