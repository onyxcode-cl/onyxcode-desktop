import type { Messages } from '../index'
import type { tasksComputer as es } from '../es/tasksComputer'

export const tasksComputer = {} as const satisfies Messages<typeof es>
