import { describe, expect, it } from 'vitest'
import { chooseRoleModel, roleHasOwnModel, roleOfAgent, withRoleModel } from './plan-exec-models'

const conv = { providerID: 'openai', modelID: 'gpt-5-mini' }
const strong = { providerID: 'anthropic', modelID: 'big' }
const cheap = { providerID: 'deepseek', modelID: 'cheap' }
const ok = (): boolean => false

describe('elección del modelo para planear y ejecutar (D2)', () => {
  it('sin ajustes usa el de la conversación (comportamiento de siempre)', () => {
    for (const agent of ['plan', 'build'] as const) {
      const c = chooseRoleModel({ agent, config: {}, conversation: conv, isUnavailable: ok })
      expect(c).toMatchObject({ model: conv, source: 'conversation', fallback: null })
    }
    expect(chooseRoleModel({ agent: 'plan', config: undefined, conversation: conv, isUnavailable: ok }).model).toEqual(conv)
  })

  it('Planear usa el de planear y Hacer el de ejecutar, de proveedores distintos', () => {
    const config = { plan: strong, exec: cheap }
    expect(chooseRoleModel({ agent: 'plan', config, conversation: conv, isUnavailable: ok })).toMatchObject({
      model: strong,
      role: 'plan',
      source: 'role'
    })
    expect(chooseRoleModel({ agent: 'build', config, conversation: conv, isUnavailable: ok })).toMatchObject({
      model: cheap,
      role: 'exec',
      source: 'role'
    })
  })

  it('solo uno definido: el otro paso sigue con el de la conversación', () => {
    const config = { plan: strong }
    expect(chooseRoleModel({ agent: 'build', config, conversation: conv, isUnavailable: ok }).model).toEqual(conv)
    expect(roleHasOwnModel('build', config)).toBe(false)
    expect(roleHasOwnModel('plan', config)).toBe(true)
  })

  it('el cambio hecho en la conversación gana a los ajustes', () => {
    const c = chooseRoleModel({
      agent: 'build',
      config: { exec: cheap },
      override: { exec: strong },
      conversation: conv,
      isUnavailable: ok
    })
    expect(c).toMatchObject({ model: strong, source: 'override' })
  })

  it('si el modelo elegido no existe o no tiene clave: usa el de la conversación y lo avisa', () => {
    const c = chooseRoleModel({
      agent: 'plan',
      config: { plan: strong },
      conversation: conv,
      isUnavailable: (m) => m.modelID === 'big'
    })
    expect(c).toMatchObject({ model: conv, source: 'conversation', fallback: strong })
  })

  it('roleOfAgent y withRoleModel', () => {
    expect(roleOfAgent('plan')).toBe('plan')
    expect(roleOfAgent('build')).toBe('exec')
    const a = withRoleModel({}, 'plan', strong)
    expect(a).toEqual({ plan: strong })
    expect(withRoleModel(a, 'plan', null)).toEqual({})
  })
})
