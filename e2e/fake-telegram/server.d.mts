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
export interface FakeDocument {
  chat_id: number
  message_id: number
  filename: string
  bytes: Buffer
  caption?: string
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
  readonly documents: FakeDocument[]
  readonly userMessages: { chat_id: number; text: string; at: number }[]
  sendUser(o: {
    chatId: number
    text?: string
    fromId?: number
    firstName?: string
    chatType?: string
    isBot?: boolean
    extra?: Record<string, unknown>
  }): void
  uploadFile(o: { name?: string; bytes: Uint8Array | Buffer | number[]; declaredSize?: number }): string
  sendDocument(o: { chatId: number; fileId: string; name?: string; mime?: string; caption?: string; size?: number; fromId?: number }): void
  sendPhoto(o: { chatId: number; fileId: string; caption?: string; size?: number }): void
  sendVoice(o: { chatId: number; fileId: string; seconds?: number }): void
  press(o: { chatId: number; messageId: number; data: string; fromId?: number; chatType?: string }): string
  sendRaw(update: Record<string, unknown>): void
  failNext(method: string, o?: { status?: number; retry_after?: number; times?: number; description?: string }): void
  revoke(): void
  setConflict(on: boolean): void
  block(chatId: number): void
  deleteMessage(chatId: number, messageId: number): void
  to(chatId: number): FakeMessage[]
  stop(): Promise<void>
}
export function startFakeTelegram(opts?: {
  token?: string
  username?: string
  maxHoldMs?: number
  port?: number
  firstUpdateId?: number
  editFloodMs?: number
}): Promise<FakeTelegram>
export function parseMultipart(
  body: Buffer,
  contentType: string
): { fields: Record<string, string>; files: Record<string, { filename: string; bytes: Buffer }> } | null
export function htmlProblem(text: string): string | null
export function visibleText(html: string): string
