export const REPO: string
export const SIGNATURE: { identifier: string; teamId: string; authority: string }
export const TARGETS: Record<string, string>
export const DEFAULT_TARGETS: string[]
export const SUBJECT_RE: RegExp
export const BIN_MAX_SIZE: number
export function bodyChecksum(body: string, name: string): string | null
export interface PinIo {
  getJson(url: string): Promise<unknown>
  download(url: string): Promise<Buffer>
  extract(tgz: Buffer): Promise<Buffer>
  codesign(bin: Buffer): Promise<{ identifier: string | null; teamId: string | null; authorities: string[] }>
}
export function buildPin(o: { version: string; io: PinIo; targets?: string[]; authenticodeSubject?: string }): Promise<{
  version: string
  releasedAt: string
  assets: Record<string, unknown>
}>
export function serializePin(pin: unknown): string
export function mergePin<T extends { version: string; assets: Record<string, unknown> }>(existing: T | null | undefined, fresh: T): T
