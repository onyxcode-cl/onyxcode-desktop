import { describe, expect, it } from 'vitest'
import { buildInlineConfig } from './config'

describe('buildInlineConfig (sidecar principal)', () => {
  it('fija share:disabled y autoupdate:false, con y sin navegador', () => {
    for (const browserMcp of [null, { type: 'remote', url: 'http://127.0.0.1:1/mcp' }]) {
      const c = buildInlineConfig({ browserMcp })
      expect(c.share).toBe('disabled')
      expect(c.autoupdate).toBe(false)
    }
    expect(buildInlineConfig().share).toBe('disabled')
  })
})
