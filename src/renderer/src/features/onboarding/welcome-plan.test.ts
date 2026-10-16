import { describe, expect, it } from 'vitest'
import { canRetry, engineState, toInstall, welcomeOverall, welcomeView } from './welcome-plan'

describe('welcome-plan', () => {
  it('el estado del motor sale de si se encontró', () => {
    expect(engineState(null)).toBe('checking')
    expect(engineState(true)).toBe('ready')
    expect(engineState(false)).toBe('failed')
  })

  it('«working» mientras algo se revisa, espera o descarga', () => {
    expect(welcomeOverall({ engine: 'checking' })).toBe('working')
    expect(welcomeOverall({ engine: 'ready', craft: 'pending' })).toBe('working')
    expect(welcomeOverall({ engine: 'ready', craft: 'downloading', sandbox: 'failed' })).toBe('working')
  })

  it('«failed» si nada trabaja y algo falló; «ready» si todo está listo', () => {
    expect(welcomeOverall({ engine: 'ready', craft: 'failed' })).toBe('failed')
    expect(welcomeOverall({ engine: 'ready', craft: 'ready', sandbox: 'ready' })).toBe('ready')
    expect(welcomeOverall({})).toBe('ready')
  })

  it('solo se instala lo que espera su turno, en orden y sin el motor', () => {
    expect(toInstall({ engine: 'pending', craft: 'pending', sandbox: 'pending' })).toEqual(['craft', 'sandbox'])
    expect(toInstall({ engine: 'ready', craft: 'ready', sandbox: 'pending' })).toEqual(['sandbox'])
    expect(toInstall({ craft: 'failed' })).toEqual([])
  })

  it('los permisos de macOS ya no forman parte de la bienvenida', () => {
    expect(toInstall({ engine: 'ready', craft: 'pending', sandbox: 'pending' })).toEqual(['craft', 'sandbox'])
    expect(canRetry({ craft: 'failed' })).toBe(true)
  })

  it('welcomeView: todo bien → saludo; mientras se revisa → «checking»', () => {
    expect(welcomeView({ engine: 'ready' }, true)).toBe('greeting')
    expect(welcomeView({ engine: 'ready', craft: 'ready', sandbox: 'ready' }, true)).toBe('greeting')
    expect(welcomeView({ engine: 'ready' }, false)).toBe('checking')
    expect(welcomeView({ engine: 'checking' }, true)).toBe('checking')
  })

  it('welcomeView: algo que requiere atención (falta el motor, algo por descargar o algo falló) muestra la lista', () => {
    expect(welcomeView({ engine: 'failed' }, true)).toBe('attention')
    expect(welcomeView({ engine: 'failed' }, false)).toBe('attention')
    expect(welcomeView({ engine: 'ready', craft: 'pending' }, true)).toBe('attention')
    expect(welcomeView({ engine: 'ready', sandbox: 'downloading' }, true)).toBe('attention')
    expect(welcomeView({ engine: 'ready', craft: 'failed' }, true)).toBe('attention')
  })

  it('reintentar solo vale para lo descargable', () => {
    expect(canRetry({ engine: 'failed' })).toBe(false)
    expect(canRetry({ engine: 'failed', craft: 'failed' })).toBe(true)
    expect(canRetry({ craft: 'ready' })).toBe(false)
  })
})
