import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, net: {} }))
import { runtimesOffered } from './service'

describe('oferta de runtimes independiente del catálogo local', () => {
  it.each(['darwin', 'win32'])('%s ofrece Node.js y uv para la IA', (platform) => {
    expect(runtimesOffered(platform)).toBe(true)
  })
  it('no ofrece plataformas sin distribución de la app', () => {
    expect(runtimesOffered('linux')).toBe(false)
  })
})
