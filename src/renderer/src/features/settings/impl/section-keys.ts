/** Prefijos de claves i18n que pintan cada sección de Ajustes (de aquí sale el índice del buscador; sin copiar textos). */
export const SECTION_KEYS = {
  general: ['settings.general.', 'tasks.learn.', 'settings.extras.'],
  instructions: ['instr.'],
  memory: ['memory.'],
  models: ['models.'],
  usage: ['settings.usage.'],
  shortcuts: ['settings.shortcuts.'],
  tasks: ['tasksSettings.'],
  network: ['misc.net.'],
  automode: ['misc.auto.'],
  engine: ['settings.engine.'],
  helpers: ['settings.helpers.'],
  computer: ['misc.computer.'],
  browser: ['misc.browser.'],
  mcp: ['mcp.header.', 'mcp.form.', 'mcp.catalog.', 'mcp.flags.', 'mcp.note.', 'mcp.badge.', 'mcp.add', 'mcp.refresh', 'mcp.viewFile'],
  import: ['import.title', 'import.intro', 'import.source.', 'import.guarantee.'],
  remote: ['remote.devices.', 'remote.qr.', 'remote.conn.', 'remote.travel.', 'remote.state.', 'remote.activity.', 'remote.title'],
  telegram: [
    'telegram.title',
    'telegram.intro',
    'telegram.scope',
    'telegram.privacy.',
    'telegram.switch.',
    'telegram.status.',
    'telegram.step',
    'telegram.actions.',
    'telegram.test.',
    'telegram.audit.'
  ],
  diagnostics: ['misc.diag.', 'settings.doctor.'],
  about: ['settings.about.']
} as const satisfies Record<string, readonly string[]>
