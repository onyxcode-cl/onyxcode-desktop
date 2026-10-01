import type { Messages } from '../index'
import type { tasks as es } from '../es/tasks'

export const tasks = {} as const satisfies Messages<typeof es>
