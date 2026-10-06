export const ROOTFS_REPO: string
export const OPENCODE_REPO: string
export const OPENCODE_LINUX_ASSET: string
export const OPENCODE_LINUX_KEY: string
export const ROOTFS_VERSION_RE: RegExp
export const OPENCODE_MAX_SIZE: number
export interface RootfsBuild {
  id: string
  version: string
  arch: string
  snapshot: string
  epoch: number
  builtAt: string
  sha256: string
  size: number
  unpackedSize: number
}
export interface RootfsPin {
  version: string
  minVersion: string
  builtAt: string
  url: string
  sha256: string
  size: number
  unpackedMax: number
}
export interface AssetPin {
  url: string
  sha256: string
  size: number
}
export function rootfsUrl(version: string): string
export function parseBuildJson(raw: unknown, label?: string): RootfsBuild
export function compareVersions(x: string, y: string): -1 | 0 | 1
export function buildRootfsPin(o: {
  version: string
  minVersion?: string
  builds: unknown[]
  download(url: string): Promise<Buffer>
  wslConf: string
}): Promise<RootfsPin>
export function buildOpencodeLinuxAsset(o: {
  version: string
  io: { getJson(url: string): Promise<any>; download(url: string): Promise<Buffer> }
}): Promise<AssetPin>
export function mergePin<T extends { version: string; assets: Record<string, unknown> }>(
  existing: T,
  o: { rootfs: RootfsPin; opencodeLinux: AssetPin }
): T & { 'wsl-rootfs': RootfsPin }
export function serializePin(pin: unknown): string
