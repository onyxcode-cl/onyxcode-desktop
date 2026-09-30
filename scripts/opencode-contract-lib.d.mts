export interface SdkNode {
  methods: Record<string, string>
  children: Record<string, SdkNode>
}
export interface Sdk {
  routes: Set<string>
  tree: SdkNode
}
export const ROOT: string
export const SNAPSHOT_PATH: string
export function routeKey(method: string, path: string): string
export function parseSdk(source: string): Sdk
export function sdkRoutes(file?: string): Sdk
export function sdkCallsInSource(src: string, tree: SdkNode): Array<{ call: string; route: string }>
export function directCallsInSource(
  src: string,
  routes: Set<string>
): { routes: Array<{ literal: string; route: string }>; unmatched: string[] }
export function usedRoutes(o?: { root?: string; sdk?: Sdk }): { routes: string[]; sdk: string[]; direct: string[]; unmatched: string[] }
export function routesFromOpenApi(doc: unknown): Set<string>
export function schemaDigests(doc: unknown, keys: string[]): Record<string, string | null>
export function compareContract(input: {
  used: string[]
  actual: Iterable<string>
  snapshot: Iterable<string>
  actualSchemas: Record<string, string | null>
  snapshotSchemas: Record<string, string>
}): { code: 0 | 1 | 2; missing: string[]; added: string[]; removed: string[]; changed: string[]; unbaselined: string[] }
