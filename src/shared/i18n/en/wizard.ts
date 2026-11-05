import type { Messages } from '../index'
import type { wizard as es } from '../es/wizard'

export const wizard = {
  'wizard.header': 'Connect your AI · Step {step} of {total}',
  'wizard.skip': 'Skip',
  'wizard.back': 'Back',
  'wizard.tryExample': 'Try an example',
  'wizard.sampleTask': 'Create a folder called “My first task” on the Desktop and put a text file with a greeting inside it.',
  'wizard.start': 'Get started',
  'wizard.continue': 'Continue',
  'wizard.stepTitle.bundled': 'Everything is ready',
  'wizard.stepTitle.install': 'The AI program is missing',
  'wizard.stepTitle.auth': 'Connect your AI',
  'wizard.stepTitle.model': 'Choose your model',
  'wizard.stepTitle.modes': 'How you can use it',
  'wizard.stepTitle.modes.win': 'How you can use it',
  'wizard.stepTitle.permissions': 'Permissions on your Mac',
  'wizard.fullControl': 'Full Mac control',
  'wizard.fullControl.win': 'Full PC control',
  'wizard.fullControlShort': 'Full control',
  'wizard.connectTasksNotice':
    'Any of these services works in every mode. Only {tasks} with “One folder” requires OpenCode Go or the free models; to use another service there, choose {fullControl}.',
  'wizard.connectTasksNotice.win': 'Any of these services works in every mode.',
  'wizard.connectTermsNotice': 'Each person is responsible for complying with the terms of their AI service and OpenCode’s.',

  'wizard.opencode.bundledLead': '{app} includes its own engine (Lazunox Motor), so there is nothing to install.',
  'wizard.opencode.included': 'Built in: Lazunox Motor{version}',
  'wizard.opencode.starting': 'Starting Lazunox Motor…',
  'wizard.opencode.running': 'Lazunox Motor is running.',
  'wizard.opencode.ownCliHint': 'Prefer your own OpenCode installation? You can use it instead.',
  'wizard.opencode.useMyCli': 'Use a program I already have…',
  'wizard.opencode.retry': 'Try again',
  'wizard.opencode.leadFound': '{app} uses Lazunox Motor to make the AI work. We already found it on this Mac.',
  'wizard.opencode.leadFound.win': '{app} uses Lazunox Motor to make the AI work. We already found it on this PC.',
  'wizard.opencode.leadMissing':
    '{app} needs a program that makes the AI work (Lazunox Motor) and couldn’t find it on this Mac. It normally comes included: reinstall {app}. Or install it yourself:',
  'wizard.opencode.leadMissing.win':
    '{app} needs a program that makes the AI work (Lazunox Motor) and couldn’t find it on this PC. It normally comes included: reinstall {app}. Or install it yourself:',
  'wizard.opencode.searching': 'Looking for Lazunox Motor…',
  'wizard.opencode.foundTitle': 'Lazunox Motor found{version}',
  'wizard.opencode.versionSuffix': ' (version {version})',
  'wizard.opencode.versionMismatch': 'This version of {app} was tested with Lazunox Motor {sdk}. Other versions may behave differently.',
  'wizard.opencode.notFound': 'Lazunox Motor was not found.',
  'wizard.opencode.installHint':
    'Install it by opening the Terminal app and pasting this command (copy it with the button; {app} never runs it for you):',
  'wizard.opencode.installHint.win':
    'Install it by opening PowerShell and pasting this command (copy it with the button; {app} never runs it for you). It needs Node.js:',
  'wizard.opencode.copied': 'Command copied',
  'wizard.opencode.copyInstall': 'Copy install command',
  'wizard.opencode.openDocs': 'Open instructions',
  'wizard.opencode.pickBinary': 'Choose the program…',

  'wizard.auth.lead': 'The AI needs a model to answer. You can start right now, with no account or card.',
  'wizard.auth.freeTitle': 'Start for free',
  'wizard.auth.free': 'Free',
  'wizard.auth.freeChosen': 'Free model chosen',
  'wizard.auth.freeDescription':
    'No account, key or card. It is slower and less accurate than a paid service, and it may change over time. You can switch any time in Settings › Models.',
  'wizard.auth.freeUse': 'Use the free model',
  'wizard.auth.freeUnavailable': 'No free models are available right now. Try another service or try again later.',
  'wizard.auth.paid': 'Subscription',
  'wizard.auth.goConnected': 'OpenCode Go connected',
  'wizard.auth.goDescription':
    'Paid subscription with open models for coding. Use it only if you already have one: copy your access key and paste it here. It is stored only for {app}, in a protected place on your computer.',
  'wizard.auth.getKey': 'Get my access key',
  'wizard.auth.learnGo': 'Learn about OpenCode Go',
  'wizard.auth.otherTitle': 'Another AI service',
  'wizard.auth.otherDescription': 'Use another AI service’s access key, or sign in with your account.',
  'wizard.auth.waitingServer': 'Waiting for the AI to finish starting… If it takes too long, close and reopen {app}.',
  'wizard.auth.catalogError': 'Couldn’t load the list of AI services: {error}',
  'wizard.auth.loadingProviders': 'Loading AI services…',
  'wizard.auth.noOthers': 'No other AI services are available right now.',
  'wizard.auth.providerConnected': '{name} connected',

  'wizard.model.lead':
    'This is the model (the “brain”) that will answer in your chats and tasks when you don’t pick another. You can change it any time in Settings › Models.',
  'wizard.model.default': 'Default model',

  'wizard.modes.lead': 'Switch modes from the sidebar (⌃Tab cycles through all four).',
  'wizard.modes.lead.win': 'Switch modes from the sidebar (Ctrl+Tab cycles through all three).',
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
  'wizard.permissions.review': 'You can review or remove them in System Settings › Privacy & Security.',
  'wizard.stepTitle.setup': 'All set',
  'wizard.setup.lead':
    'Anything you left for later (ArtCraft, Node.js and uv, permissions) can be installed or turned on whenever you want from Settings › Diagnostics › “Install or turn on pieces”. You can start now.',
  'wizard.welcome.title': 'Welcome to {app}',
  'wizard.welcome.tagline': 'An AI assistant that chats with you and does tasks on your own computer.',
  'wizard.welcome.madeBy': 'Made by {maker}',
  'wizard.perms.restart.title': 'A restart is needed for Screen Recording',
  'wizard.perms.restart.body':
    'Accessibility is already on. Also turn on Screen Recording in System Settings (that pane was opened) and restart {app}: macOS only applies Screen Recording when the app opens again.',
  'wizard.perms.restart.button': 'Restart {app}',
  'wizard.perms.location.translocated':
    '{app} is running from a temporary macOS location (App Translocation), so permissions are not saved properly. Move {app} to the Applications folder, quit it and open it from there.',
  'wizard.perms.location.volume':
    '{app} is running from the installer (.dmg). Drag {app} to the Applications folder, eject the installer, quit it and open it from Applications.',
  'wizard.perms.help.toggle': "Permissions won't turn on",
  'wizard.perms.help.intro':
    'Try this in order: 1) Turn on {app} in System Settings › Privacy & Security › Accessibility and Screen Recording. 2) Restart {app}: macOS applies Screen Recording only when the app opens again. 3) Check that {app} is in Applications, not in the .dmg or Downloads.',
  'wizard.perms.help.repair':
    'If nothing changes, an old permission from a previous version may be stuck. Quit {app} completely (Cmd+Q), paste these commands in the Terminal app, open it again and grant the permissions again. {app} does not run them for you.',
  'wizard.perms.help.copy': 'Copy commands',
  'wizard.perms.help.copied': 'Copied',
  'wizard.perms.help.restart': 'Restart {app}',
  'preflight.laterHint':
    'Anything you leave for later can be installed or turned on from Settings › Diagnostics › “Install or turn on pieces”.',
  'settings.diag.components.open': 'Install or turn on pieces',
  'preflight.step.install': 'Step {n} of {total} · Install what is needed',
  'preflight.step.perms': 'Step {n} of {total} · macOS permissions',
  'preflight.acceptAll': 'Accept all and install',
  'preflight.acceptAll.subtitle': 'One click and {app} downloads and installs everything it needs. Or choose what to install.',
  'preflight.acceptAll.size':
    'About {size} will be downloaded in total, from GitHub and nodejs.org; it is verified as authentic and asks for no administrator password.',
  'preflight.acceptAll.progress': '{done} of {total} ready',
  'preflight.custom.show': 'Choose what to install',
  'preflight.custom.hide': 'Back to the single button',
  'preflight.state.click': 'Needs your click',
  'preflight.perms.title': 'macOS permissions',
  'preflight.perms.intro':
    'Accessibility lets {app} move the mouse and type for you; Screen Recording lets it see what is on screen. Access to your files is optional. Each button opens the right panel in System Settings.',
  'preflight.perms.note':
    'macOS permissions are turned on by hand, when you need them. You can leave them for later: they are asked for when you use “Full control” or from Settings › Diagnostics.',
  'preflight.title': 'Getting {app} ready',
  'preflight.subtitle.blocking': 'Something essential is missing for {app} to work. You can fix it here.',
  'preflight.subtitle.optional':
    'You can already use {app}. These pieces are optional: check the ones you want and install them now, or leave them for later (they are also in Settings).',
  'preflight.checking': 'Checking your computer…',
  'preflight.size': 'About {size} will be downloaded.',
  'preflight.size.none': 'Nothing is checked: nothing will be downloaded.',
  'preflight.size.mb': '{n} MB',
  'preflight.size.gb': '{n} GB',
  'preflight.install': 'Install what is checked',
  'preflight.installing': 'Installing…',
  'preflight.retry': 'Retry',
  'preflight.recheck': 'Check again',
  'preflight.copy': 'Copy details',
  'preflight.copied': 'Details copied',
  'preflight.continueAnyway': 'Later',
  'preflight.continue': 'Continue',
  'preflight.cannotSkip': 'This cannot be skipped: {app} does not work without it.',
  'preflight.allReady': 'All set.',
  'preflight.engine.pick': 'Choose engine…',
  'preflight.perms.grant': 'Grant permissions',
  'preflight.state.ready': 'Ready',
  'preflight.state.missing': 'Missing',
  'preflight.state.downloading': 'Installing…',
  'preflight.state.failed': 'Failed',
  'preflight.state.pending': 'Pending',
  'preflight.progress': '{pct} %',
  'preflight.version': 'version {v}',
  'preflight.c.storage': 'Data folder',
  'preflight.c.disk': 'Disk space',
  'preflight.c.engine': 'Agent engine',
  'preflight.c.craft': 'Document designer (ArtCraft)',
  'preflight.c.runtimes': 'Node.js and uv (to connect your email and calendar)',
  'preflight.c.sandbox': 'Overdrive isolated environment',
  'preflight.c.helper': 'Computer control helper',
  'preflight.c.perms': 'macOS permissions',
  'preflight.c.files': 'Access to your files (optional)',
  'preflight.hint.files.denied':
    'Let {app} read your folders without asking folder by folder (Documents, Desktop, Downloads…). It is a broad permission: you can leave it off and {app} will ask you for each folder. After turning it on, macOS may ask you to restart {app}.',
  'preflight.hint.files.unknown':
    'Full Disk Access could not be checked. It is optional: if you leave it off, {app} will ask you for each folder.',
  'preflight.files.open': 'Open System Settings',
  'preflight.files.restart': 'Restart {app}',
  'preflight.c.location': 'App location',
  'preflight.hint.engine.not-found':
    'The engine that ships with the app was not found. Reinstall {app} from the installer or choose an engine that is already installed.',
  'preflight.hint.engine.not-responding':
    'The engine is there but does not respond. Reinstall {app} from the installer or choose another engine.',
  'preflight.hint.craft.missing':
    'Optional, to create and view Word, Excel, PowerPoint and PDF files with good design. Downloaded from GitHub (about {mb} MB) and verified before use.',
  'preflight.hint.craft.incomplete':
    'Some pieces are missing or damaged; they are downloaded again (about {mb} MB) and verified before use.',
  'preflight.hint.runtimes.missing':
    'Two small programs used by the email, calendar and files connectors. Downloaded once (about {mb} MB) from nodejs.org and github.com and checked to be the genuine files before use. It does not ask for an administrator password. Everything else works without them.',
  'preflight.hint.runtimes.broken':
    'Some pieces are missing or damaged; they are downloaded again (about {mb} MB) from nodejs.org and github.com and verified before use.',
  'preflight.hint.sandbox.needsSetup':
    'Optional, only for Overdrive. Set up once (about 2 GB of disk), using what the app already includes.',
  'preflight.hint.sandbox.broken':
    'Optional, only for Overdrive. The environment is damaged; it is set up again from what the app includes.',
  'preflight.hint.sandbox.other':
    'Needs Windows features turned on (WSL or virtualization). The steps are in Overdrive; you can continue and do it later.',
  'preflight.hint.helper.not-found': 'The {app} control helper was not found. Reinstall the app to be able to control the computer.',
  'preflight.hint.perms.both': 'The Accessibility and Screen Recording permissions are missing; computer control needs them.',
  'preflight.hint.perms.accessibility': 'The Accessibility permission is missing; computer control needs it.',
  'preflight.hint.perms.both-adhoc':
    'The Accessibility and Screen Recording permissions are missing. If they were already on, macOS drops them every time {app} updates: turn them off and on again in System Settings, then press “Check again”.',
  'preflight.hint.perms.accessibility-adhoc':
    'The Accessibility permission is missing. If it was already on, macOS drops it every time {app} updates: turn it off and on again in System Settings, then press “Check again”.',
  'preflight.hint.perms.restart':
    'Accessibility is on but Screen Recording is not yet: turn it on and restart {app} (macOS applies it when the app opens again).',
  'preflight.hint.perms.unknown': 'The permissions could not be checked. Press “Check again”.',
  'preflight.hint.location.translocated':
    '{app} is running from a temporary macOS location, so permissions are not saved properly. Move it to Applications and open it from there.',
  'preflight.hint.location.volume':
    '{app} is running from the installer (.dmg). Drag it to Applications, eject the installer and open it from there.',
  'preflight.hint.location.elsewhere':
    '{app} is not in the Applications folder. Drag it there and open it from there: that way macOS remembers the permissions and it can update itself.',
  'preflight.hint.disk.low-space': 'There is not enough free space to install what is missing. Free up disk space or leave it for later.',
  'preflight.hint.storage.not-writable':
    '{app} cannot write to its data folder. Check your user permissions on that folder and press “Retry”.',
  'preflight.hint.generic.essential': 'This component is missing and {app} needs it.',
  'preflight.hint.generic.optional': 'This notice does not stop you from using {app}.',
  'preflight.error.engine': 'The engine could not be restarted. Reinstall {app} from the installer.',
  'preflight.failed.title': '“{name}” could not be installed',
  'settings.diag.components.title': 'Component status',
  'settings.diag.components.desc': 'What is ready and what is missing for {app} to work. It is also included in the exported report.',
  'settings.diag.components.recheck': 'Check again',
  'settings.diag.components.checking': 'Checking…',
  'settings.diag.components.error': 'The components could not be checked.',
  'wizard.auth.engineFailed': 'The AI couldn’t start. Press “Retry”; if it stays the same, reinstall {app}.',
  'wizard.setup.permsLater':
    'macOS permissions: only if you use “{mode}”, {app} will ask for them at that moment. There is nothing to do now.',
  'wizard.example.title': 'Try an example',
  'wizard.example.body': 'See how it works with a sample task already written: “{sample}” You only have to send it.',
  'wizard.welcome.start': 'Get started',
  'wizard.welcome.greetingNote':
    'A few short steps: install what is needed, turn on permissions (Mac only) and connect your AI. You can start for free.',
  'wizard.auth.moreWays': 'Other ways to connect'
} as const satisfies Messages<typeof es>
