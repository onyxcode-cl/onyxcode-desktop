import type { ElectronApplication } from 'playwright-core'

export interface SpiedNotification {
  title: string
  body: string
}

export interface NotificationSpy {
  /** Notificaciones nativas mostradas (`Notification.prototype.show`) desde `spyNotifications`. */
  shown(): Promise<SpiedNotification[]>
  /** Texto actual del badge del Dock ('' si no hay). */
  badge(): Promise<string>
  clear(): Promise<void>
}

/** Espía Notification.prototype.show (sin mostrar nada real) y el badge del Dock en main. */
export async function spyNotifications(app: ElectronApplication): Promise<NotificationSpy> {
  await app.evaluate(({ Notification }) => {
    const g = globalThis as unknown as { __e2eNotifs?: SpiedNotification[]; __e2eNotifPatched?: boolean }
    g.__e2eNotifs = []
    if (g.__e2eNotifPatched) return
    g.__e2eNotifPatched = true
    Notification.prototype.show = function (this: { title: string; body: string }) {
      g.__e2eNotifs!.push({ title: this.title, body: this.body })
    }
  })
  return {
    shown: () => app.evaluate(() => (globalThis as unknown as { __e2eNotifs?: SpiedNotification[] }).__e2eNotifs ?? []),
    badge: () => app.evaluate(({ app: a }) => a.dock?.getBadge() ?? ''),
    clear: () =>
      app.evaluate(({ app: a }) => {
        ;(globalThis as unknown as { __e2eNotifs: SpiedNotification[] }).__e2eNotifs = []
        a.dock?.setBadge('')
      })
  }
}
