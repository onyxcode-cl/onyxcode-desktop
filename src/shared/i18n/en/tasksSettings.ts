import type { Messages } from '../index'
import type { tasksSettings as es } from '../es/tasksSettings'

export const tasksSettings = {} as const satisfies Messages<typeof es>
