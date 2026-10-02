import type { Messages } from '../index'
import type { account as es } from '../es/account'

export const account = {
  'account.dataSentence': 'We store your email to manage your account and count users. Your conversations and AI keys stay on your Mac.',
  'account.dataSentence.win': 'We store your email to manage your account and count users. Your conversations and AI keys stay on your PC.',
  'account.existingUserNote': 'Your conversations and AI keys stay on your Mac.',
  'account.existingUserNote.win': 'Your conversations and AI keys stay on your PC.',
  'account.banner.expired.title': 'Your session has ended',
  'account.banner.expired.body': 'For your security, sign in again to keep using the app.',
  'account.banner.deleted.title': 'This account no longer exists',
  'account.banner.deleted.body': 'It was deleted. You can create a new account.',
  'account.gate.readFailed': 'Couldn’t read the account status.',
  'account.gate.retry': 'Try again',
  'account.legal.close': 'Close',

  'account.tab.login': 'Sign in',
  'account.tab.signup': 'Create account',
  'account.tab.aria': 'Access',
  'account.err.retry': 'Couldn’t try again.',
  'account.err.signOut': 'Couldn’t sign out.',
  'account.err.sendCode': 'Couldn’t send the code.',
  'account.err.verifyCode': 'Couldn’t verify the code.',
  'account.err.google': 'Couldn’t sign in with Google.',

  'account.checking.title': 'Checking your session…',
  'account.checking.wait': 'One moment.',
  'account.waiting.title': 'Waiting for the browser…',
  'account.waiting.sub':
    'Finish signing in with Google in your browser. When you’re done, come back here: the app will continue on its own.',
  'account.waiting.status': 'Waiting for confirmation (up to 5 minutes).',
  'account.waiting.cancel': 'Cancel',
  'account.offline.title': 'Can’t reach the server',
  'account.offline.sub':
    'We couldn’t verify your session with the server. While offline, the app only opens for up to 30 days after the last check. Connect to the internet and try again.',
  'account.offline.retry': 'Try again',
  'account.offline.otherAccount': 'Use another account',
  'account.offline.session': 'Signed in as {email}',

  'account.terms.accept': 'I accept the',
  'account.terms.terms': 'terms',
  'account.terms.and': 'and the',
  'account.terms.privacy': 'privacy policy',

  'account.choose.login.sub': 'Sign in with your Google account or with the code we email you. There are no passwords.',
  'account.choose.signup.sub': 'Create an account with your Google account or your email. There are no passwords.',
  'account.choose.login.title': 'Sign in to {app}',
  'account.choose.signup.title': 'Create your {app} account',
  'account.choose.existingNote': 'You already used {app}: we now ask for an account. {note}',
  'account.choose.checkTerms': 'Check the box to continue.',
  'account.choose.googleLogin': 'Sign in with Google',
  'account.choose.googleSignup': 'Sign up with Google',
  'account.choose.emailLogin': 'Sign in with your email',
  'account.choose.emailSignup': 'Create an account with your email',
  'account.choose.memoryOnly': 'The macOS Keychain couldn’t be used on this Mac: your session will only last until you quit the app.',
  'account.choose.memoryOnly.win':
    'Windows credential storage couldn’t be used on this PC: your session will only last until you quit the app.',

  'account.email.sub': 'We’ll send you a 6-digit code to confirm the email is yours.',
  'account.email.titleLogin': 'Sign in with your email',
  'account.email.titleSignup': 'Create an account',
  'account.email.label': 'Email address',
  'account.email.placeholder': 'you@example.com',
  'account.email.back': 'Back',
  'account.email.send': 'Send code',

  'account.code.sub1': 'Enter the {length}-digit code we sent to',
  'account.code.sub2': 'It expires in 10 minutes.',
  'account.code.newAccountNote': 'If you don’t have an account yet, we’ll create one when you confirm the code.',
  'account.code.title': 'Check your email',
  'account.code.label': 'Code',
  'account.code.changeEmail': 'Change email',
  'account.code.verify': 'Sign in',
  'account.code.didntArrive': 'Didn’t get it?',
  'account.code.resend': 'Send another code'
} as const satisfies Messages<typeof es>
