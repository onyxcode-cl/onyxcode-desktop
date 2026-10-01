import type { Messages } from '../index'
import type { wizard as es } from '../es/wizard'

export const wizard = {
  'wizard.header': 'Welcome to {app} · Step {step} of {total}',
  'wizard.skip': 'Skip',
  'wizard.back': 'Back',
  'wizard.start': 'Get started',
  'wizard.continue': 'Continue',
  'wizard.stepTitle.bundled': 'Built-in engine',
  'wizard.stepTitle.install': 'Install or locate OpenCode',
  'wizard.stepTitle.auth': 'Connect your AI',
  'wizard.stepTitle.model': 'Choose your model',
  'wizard.stepTitle.modes': 'The four modes',
  'wizard.stepTitle.permissions': 'macOS permissions',
  'wizard.fullControl': 'Full Mac control',
  'wizard.fullControlShort': 'Full control',
  'wizard.connectTasksNotice':
    'OpenCode works with any of these providers. The only exception is {tasks} with the sandbox, which in {app} only supports OpenCode Go (and OpenCode’s free models); to use another provider there, choose {fullControl}.',
  'wizard.connectTermsNotice': 'Each person is responsible for complying with their provider’s terms and OpenCode’s.',

  'wizard.opencode.bundledLead': '{app} includes OpenCode as its engine, so there is nothing to install.',
  'wizard.opencode.included': 'Built in: OpenCode{version}',
  'wizard.opencode.starting': 'Starting OpenCode…',
  'wizard.opencode.running': 'OpenCode is running.',
  'wizard.opencode.ownCliHint': 'Prefer your own OpenCode installation? You can use it instead.',
  'wizard.opencode.useMyCli': 'Use my CLI…',
  'wizard.opencode.retry': 'Try again',
  'wizard.opencode.leadFound': '{app} uses OpenCode as its engine. We already found it on this Mac.',
  'wizard.opencode.leadMissing': '{app} uses OpenCode as its engine. You need to have it installed on this Mac.',
  'wizard.opencode.searching': 'Looking for OpenCode…',
  'wizard.opencode.foundTitle': 'OpenCode found{version}',
  'wizard.opencode.versionSuffix': ' (version {version})',
  'wizard.opencode.versionMismatch': 'This version of {app} was tested with OpenCode {sdk}. Other versions may behave differently.',
  'wizard.opencode.notFound': 'OpenCode was not found.',
  'wizard.opencode.installHint':
    'Install it by opening the Terminal app and pasting this command (copy it with the button; {app} never runs it for you):',
  'wizard.opencode.copied': 'Command copied',
  'wizard.opencode.copyInstall': 'Copy install command',
  'wizard.opencode.openDocs': 'Open instructions',
  'wizard.opencode.pickBinary': 'Choose binary…',

  'wizard.auth.lead': 'Choose how to give the app access to AI models. You can add or change providers later in Settings › Models.',
  'wizard.auth.recommended': 'Recommended',
  'wizard.auth.goConnected': 'OpenCode Go connected',
  'wizard.auth.goDescription':
    'OpenCode Go is an affordable subscription with access to open models for coding. Create your account, subscribe, and copy your API key, then paste it here. It is stored in OpenCode, not in {app}.',
  'wizard.auth.getKey': 'Get my key',
  'wizard.auth.learnGo': 'Learn about OpenCode Go',
  'wizard.auth.otherTitle': 'Other provider / API key',
  'wizard.auth.otherDescription': 'Use a key or sign in with a provider from the OpenCode catalog.',
  'wizard.auth.waitingServer': 'Waiting for OpenCode… Go back to the previous step if it does not start.',
  'wizard.auth.catalogError': 'Couldn’t load the provider list: {error}',
  'wizard.auth.loadingProviders': 'Loading providers…',
  'wizard.auth.noOthers': 'No other providers are available in OpenCode right now.',
  'wizard.auth.providerConnected': '{name} connected',

  'wizard.model.lead':
    'This is the model chats and tasks will use when you don’t pick another. You can change it any time in Settings › Models.',
  'wizard.model.default': 'Default model',

  'wizard.modes.lead': 'Switch modes from the sidebar (⌃Tab cycles through all four).',
  'wizard.modes.chat': 'General conversations with the model, without touching your files.',
  'wizard.modes.code': 'A coding agent that works on your project folder.',
  'wizard.modes.tasks': 'Autonomous tasks on your documents and folders, with permissions you approve.',
  'wizard.modes.routines': 'Scheduled tasks that run on their own at the time you choose.',

  'wizard.permissions.lead': '{app} doesn’t ask for any special macOS permissions when you start.',
  'wizard.permissions.intro': 'Only if you turn on “{mode}” in a task will macOS ask for two permissions:',
  'wizard.permissions.accessibility': 'Accessibility',
  'wizard.permissions.accessibilityHint': '(to move the mouse, click, and type) and',
  'wizard.permissions.screen': 'Screen Recording',
  'wizard.permissions.screenHint': '(to see what is on screen).',
  'wizard.permissions.review': 'You can review or remove them in System Settings › Privacy & Security.'
} as const satisfies Messages<typeof es>
