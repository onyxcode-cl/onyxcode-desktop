export const REPO: string
export const SIGNATURE: { identifier: string; teamId: string; authority: string }
export const TARGETS: Record<string, string>
export const BIN_MAX_SIZE: number
export function bodyChecksum(body: string, name: string): string | null
export interface PinIo {
  getJson(url: string): Promise<unknown>
  download(url: string): Promise<Buffer>
  extract(tgz: Buffer): Promise<Buffer>
  codesign(bin: Buffer): Promise<{ identifier: string | null; teamId: string | null; authorities: string[] }>
}
export function buildPin(o: { version: string; io: PinIo }): Promise<{
  version: string
  releasedAt: string
  assets: Record<string, unknown>
}>
export function serializePin(pin: unknown): string
