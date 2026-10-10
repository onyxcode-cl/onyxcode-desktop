import { describe, expect, it } from 'vitest'
import { greetingKey } from './Home'

describe('greetingKey', () => {
  it('elige mañana, tarde o noche según la hora', () => {
    expect(greetingKey(5)).toBe('tasks.home.greet.morning')
    expect(greetingKey(11)).toBe('tasks.home.greet.morning')
    expect(greetingKey(12)).toBe('tasks.home.greet.afternoon')
    expect(greetingKey(19)).toBe('tasks.home.greet.afternoon')
    expect(greetingKey(20)).toBe('tasks.home.greet.evening')
    expect(greetingKey(0)).toBe('tasks.home.greet.evening')
    expect(greetingKey(4)).toBe('tasks.home.greet.evening')
  })
})
