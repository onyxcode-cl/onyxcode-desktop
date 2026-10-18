export interface FakeMessage {
  chat_id: number
  message_id: number
  text: string
  parse_mode?: string
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] }
  at: number
}
export interface FakeEdit {
  chat_id: number
  message_id: number
  text: string
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] }
  at: number
}
export interface FakeTelegram {
  url: string
  port: number
  token: string
  username: string
  readonly messages: FakeMessage[]
  readonly edits: FakeEdit[]
  readonly callbackAnswers: { id: string; text?: string; show_alert: boolean }[]
  readonly requests: { method: string; params: Record<string, unknown>; tokenOk: boolean }[]
  readonly offsets: number[]
  readonly pollers: number
  sendUser(o: { chatId: number; text: string; fromId?: number; firstName?: string; chatType?: string; isBot?: boolean }): void
  press(o: { chatId: number; messageId: number; data: string; fromId?: number; chatType?: string }): string
  sendRaw(update: Record<string, unknown>): void
  failNext(method: string, o?: { status?: number; retry_after?: number; times?: number; description?: string }): void
  revoke(): void
  setConflict(on: boolean): void
  block(chatId: number): void
  to(chatId: number): FakeMessage[]
  stop(): Promise<void>
}
export function startFakeTelegram(opts?: {
  token?: string
  username?: string
  maxHoldMs?: number
  port?: number
  firstUpdateId?: number
}): Promise<FakeTelegram>
export function htmlProblem(text: string): string | null
export function visibleText(html: string): string
