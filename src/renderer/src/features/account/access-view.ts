import type { AccountState } from '@shared/account'
import { t } from '@shared/i18n'

/** Qué pantalla de acceso corresponde al estado de la cuenta. */
export type AccessView = 'checking' | 'waiting' | 'offline' | 'choose'

export function accessView(s: Pick<AccountState, 'checking' | 'status'>): AccessView {
  if (s.checking) return 'checking'
  if (s.status === 'signing-in') return 'waiting'
  if (s.status === 'offline-blocked') return 'offline'
  return 'choose'
}

export interface AccessBanner {
  title: string
  body: string
}

/** Aviso sobre las opciones de acceso cuando la sesión terminó o la cuenta ya no existe. */
export function accessBanner(s: Pick<AccountState, 'status'>): AccessBanner | null {
  if (s.status === 'expired') return { title: t('account.banner.expired.title'), body: t('account.banner.expired.body') }
  if (s.status === 'deleted') return { title: t('account.banner.deleted.title'), body: t('account.banner.deleted.body') }
  return null
}

const NOTE_KEY = 'onyx.account.note'

/** La nota «ya tenías la app» se muestra una sola vez (hasta que alguien entra). */
export function shouldShowExistingUserNote(o: { onboarded: boolean; seen: boolean }): boolean {
  return o.onboarded && !o.seen
}

export function noteSeen(): boolean {
  try {
    return localStorage.getItem(NOTE_KEY) === '1'
  } catch {
    return false
  }
}

export function markNoteSeen(): void {
  try {
    localStorage.setItem(NOTE_KEY, '1')
  } catch {
    /* sin storage: se mostrará otra vez, sin más */
  }
}
