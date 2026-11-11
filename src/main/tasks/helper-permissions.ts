/** Reglas base de resources/opencode/agents/tasks.md; la prueba de paridad evita que se separen. */
export const TASKS_BASE_PERMISSION = {
  '*': 'allow',
  read: { '*': 'allow', 'mcp:*': 'ask' },
  edit: 'allow',
  glob: 'allow',
  grep: 'allow',
  list: 'allow',
  todowrite: 'allow',
  webfetch: 'allow',
  websearch: 'allow',
  task: { '*': 'deny', 'lazunox-helper': 'allow' },
  question: 'allow',
  external_directory: 'ask',
  doom_loop: 'ask',
  bash: {
    '*': 'allow',
    'rm *': 'ask',
    'rmdir *': 'ask',
    'unlink *': 'ask',
    'find * -delete*': 'ask',
    'trash *': 'ask',
    'git push*': 'deny',
    'sudo *': 'deny',
    'shutdown*': 'deny'
  }
} as const
