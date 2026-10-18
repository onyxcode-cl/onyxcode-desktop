import type { Messages } from '../index'
import type { telegram as es } from '../es/telegram'

export const telegram = {
  // ---- Settings ----
  'telegram.nav': 'Telegram',
  'telegram.title': 'Telegram',
  'telegram.intro':
    'Get alerts on your phone and answer permission requests with a button, using a Telegram bot that you create. It is free and needs no server.',
  'telegram.scope':
    'For now the bot only sends alerts and permission requests. It cannot give orders to the AI or read your conversations.',
  'telegram.privacy.title': 'Before you turn it on',
  'telegram.privacy.body':
    'Telegram does not end-to-end encrypt bot messages and can see their content. The computer must be on with Lazunox open. Before sending, Lazunox hides keys and passwords, but review what you approve.',
  'telegram.loading': 'Loading…',
  'telegram.loadError': 'Could not read the Telegram status.',
  'telegram.retry': 'Try again',

  'telegram.switch.label': 'Telegram on',
  'telegram.switch.desc': 'Turning it off stops the bot and unlinks your chat.',
  'telegram.status.label': 'Status',
  'telegram.status.off': 'Off',
  'telegram.status.noBot': 'Bot not created yet',
  'telegram.status.idle': 'Ready to link',
  'telegram.status.linking': 'Waiting for the code',
  'telegram.status.linked': 'Linked to {name}',
  'telegram.status.linkedYou': 'you',
  'telegram.status.error': 'Problem: {reason}',

  'telegram.error.invalidToken': 'that key is not valid. Copy it again from @BotFather.',
  'telegram.error.botRevoked': 'Telegram rejected the bot key. Paste a new one.',
  'telegram.error.network': 'could not reach Telegram. Check your connection.',
  'telegram.error.conflict': 'another app is using this bot. Close it or create a new bot.',
  'telegram.error.noSecureStorage': 'this computer cannot store keys securely, so Telegram cannot be used.',
  'telegram.error.rateLimited': 'Telegram asked to wait a moment. Try again in a few seconds.',
  'telegram.error.sendFailed': 'the message could not be sent.',
  'telegram.error.unknown': 'something went wrong. Try again.',

  'telegram.steps.title': 'How to connect it',
  'telegram.step1.title': '1. Create your bot',
  'telegram.step1.body':
    'In Telegram open @BotFather, type /newbot and follow the steps. At the end it gives you a long key: that is the bot key.',
  'telegram.step1.open': 'Open @BotFather',
  'telegram.step2.title': '2. Paste the bot key',
  'telegram.step2.body': 'It is stored encrypted on this computer and never shown again.',
  'telegram.step2.placeholder': 'Bot key',
  'telegram.step2.save': 'Save key',
  'telegram.step2.saving': 'Checking…',
  'telegram.step2.saved': 'Key saved (ends in {tail})',
  'telegram.step2.bot': 'Bot: @{name}',
  'telegram.step3.title': '3. Write to your bot',
  'telegram.step3.body': 'Open your bot in Telegram and type /start.',
  'telegram.step3.open': 'Open my bot',
  'telegram.step4.title': '4. Type the code',
  'telegram.step4.body': 'The bot will ask for it. Type this 6-digit code in its chat:',
  'telegram.step4.expires': 'Expires in {time}',
  'telegram.step4.expired': 'The code expired.',
  'telegram.step4.new': 'New code',
  'telegram.step4.attempts': {
    one: '{count} attempt left.',
    other: '{count} attempts left.'
  },
  'telegram.step4.locked': 'Too many failed attempts. Wait {time} to ask for a new code.',
  'telegram.step4.turnOn': 'Turn on “Telegram on” to get the code.',

  'telegram.actions.unlink': 'Unlink',
  'telegram.actions.removeBot': 'Remove the bot',
  'telegram.actions.removeConfirm': 'This deletes the bot key and unlinks your chat. Remove the bot?',
  'telegram.actions.removeYes': 'Yes, remove',
  'telegram.actions.cancel': 'Cancel',
  'telegram.actions.stopAll': 'Stop everything now',
  'telegram.actions.stopAllDesc': 'Cuts Telegram instantly: turns the switch off and unlinks the chat. The bot key is kept.',
  'telegram.actions.working': 'One moment…',

  'telegram.test.label': 'Test message',
  'telegram.test.desc': 'Sends a short message to your chat to check that everything works.',
  'telegram.test.send': 'Send test message',
  'telegram.test.ok': 'Sent. Check your Telegram.',
  'telegram.test.notLinked': 'Link your chat first.',
  'telegram.test.tooSoon': 'Wait a few seconds before sending another.',
  'telegram.audit.note':
    'Lazunox keeps a record on this computer (with no keys) of every link and every permission answered through Telegram.',
  'telegram.pending': {
    one: '{count} permission waiting for an answer in Telegram.',
    other: '{count} permissions waiting for an answer in Telegram.'
  },

  // ---- Bot messages (Telegram HTML; dynamic text is escaped first) ----
  'telegram.msg.needCode': 'Hi. To link this chat with Lazunox, type here the 6-digit code that Lazunox shows in Settings › Telegram.',
  'telegram.msg.noCode': 'Lazunox is not waiting for a link right now. Open Settings › Telegram in Lazunox and ask for a new code.',
  'telegram.msg.linked':
    'Done: this chat is now linked with Lazunox. I will tell you when a conversation finishes or needs your permission.\n\nCommands: /status and /unlink.',
  'telegram.msg.wrong': {
    one: 'That code is not correct. {count} attempt left.',
    other: 'That code is not correct. {count} attempts left.'
  },
  'telegram.msg.expired': 'The code expired. Ask for a new one in Lazunox.',
  'telegram.msg.locked': 'Too many attempts. Wait a few minutes and ask for a new code in Lazunox.',
  'telegram.msg.ownerStart': 'This chat is already linked with Lazunox.\n\nCommands: /status and /unlink.',
  'telegram.msg.ownerText':
    'For now I only send alerts and permission requests: I cannot take instructions from here.\n\nCommands: /status and /unlink.',
  'telegram.msg.status': 'Lazunox is running.\nPermissions waiting for your answer: {pending}.\nConversations working: {busy}.',
  'telegram.msg.unlinked': 'Chat unlinked. You will no longer get Lazunox alerts.',
  'telegram.msg.test': 'Lazunox test message: everything works.',
  'telegram.msg.session': 'Conversation: {title}',
  'telegram.msg.untitled': 'untitled',
  'telegram.msg.perm.title': 'Lazunox asks for permission',
  'telegram.msg.perm.what': 'It wants to: {label}',
  'telegram.msg.perm.file': 'File: {file}',
  'telegram.msg.perm.also': 'Includes: {items}',
  'telegram.msg.perm.footer': 'The buttons last {minutes} minutes. You can also answer on the computer; whoever answers first decides.',
  'telegram.msg.perm.omitted': '[… {count} characters omitted …]',
  'telegram.msg.perm.allowed': 'Allowed once from Telegram.',
  'telegram.msg.perm.rejected': 'Rejected from Telegram.',
  'telegram.msg.perm.allowedScreen': 'Answered on the computer: allowed.',
  'telegram.msg.perm.alwaysScreen': 'Answered on the computer: always allowed.',
  'telegram.msg.perm.rejectedScreen': 'Answered on the computer: rejected.',
  'telegram.msg.perm.expired': 'The buttons expired. If it is still pending, answer it on the computer.',
  'telegram.msg.perm.gone': 'This permission is no longer pending.',
  'telegram.msg.perm.toastDone': 'Done',
  'telegram.msg.perm.toastRejected': 'Rejected',
  'telegram.msg.perm.toastAnswered': 'Already answered on the computer',
  'telegram.msg.perm.toastExpired': 'These buttons expired',
  'telegram.msg.perm.toastUsed': 'You already used this button',
  'telegram.msg.perm.toastFailed': 'Could not answer. Do it on the computer.',
  'telegram.msg.perm.toastLimit': 'Too many permissions accepted through Telegram this hour. Answer it on the computer.',
  'telegram.msg.done': 'Finished: {title}',
  'telegram.msg.question': 'The AI has a question for you in: {title}\n\n{question}\n\nAnswer on the computer.',
  'telegram.msg.error': 'There was an error in: {title}\n\n{detail}',
  'telegram.msg.stuck': 'It looks stuck: {title}. No progress for several minutes.'
} as const satisfies Messages<typeof es>
