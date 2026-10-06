import type { KeyObject } from 'node:crypto'

export const ZIP_MAX_BYTES: number
export interface UpdatePlatformSpec {
  id: string
  manifestName: string
  manifestSigName: string
  zipName: (version: string) => string
  zipRe: RegExp
  root: string
}
export const UPDATE_PLATFORMS: Record<'darwin-arm64' | 'win32-x64', UpdatePlatformSpec>
export function readPrivateKey(file: string | undefined, repoRoot: string): KeyObject
export function decodePublicKey(b64: string): KeyObject | null
export function publicKeyOf(k: KeyObject): KeyObject
export function spkiBase64(k: KeyObject): string
export function signBytes(bytes: Uint8Array, k: KeyObject): string
export function verifyBytes(bytes: Uint8Array, sig: string, k: KeyObject): boolean
export function manifestBytes(m: unknown): Buffer
export function buildManifest(o: Record<string, unknown>): Record<string, unknown>
export function parseManifest(j: unknown, expected?: 'darwin-arm64' | 'win32-x64'): Record<string, unknown> | null
export function validateManifest(
  m: Record<string, unknown>,
  c: { appId: string; current: string; tag: string; keyId: string }
): string | null
export function isSafeZipEntry(e: string): boolean
export function isSafeZipEntryWin(e: string): boolean
export function checkZipEntriesWin(
  entries: ReadonlyArray<{ name: string; isSymlink?: boolean }>
): { ok: true } | { ok: false; reason: 'empty' | 'unsafe-name' | 'duplicate' | 'symlink'; entry: string }
export function listZip(zip: string): string[]
export function readBrand(root: string): { appId: string; publicKey: string; keyId: string }
