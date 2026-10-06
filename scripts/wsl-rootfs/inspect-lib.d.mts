export const UNPACKED_MAX: number
export interface TarEntry {
  path: string
  type: string
  mode: number
  uid: number
  gid: number
  size: number
  linkname: string
  data?: Buffer
}
export interface InspectResult {
  ok: boolean
  errors: string[]
  info: { entries: number; unpackedSize: number; version: string | null }
}
export function readTar(buf: Buffer): { entries: TarEntry[]; errors: string[] }
export function normalize(p: string): string
export function unsafePath(p: string): string | null
export function inspectEntries(
  entries: TarEntry[],
  o: { wslConf: string; unpackedSize: number; unpackedMax?: number; expectedVersion?: string | null }
): InspectResult
export function inspectTarGz(tgz: Buffer, o: { wslConf: string; unpackedMax?: number; expectedVersion?: string | null }): InspectResult
