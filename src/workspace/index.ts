export { createWorkspace } from "./create.ts";
export type { CreatedWorkspace } from "./create.ts";
export { captureDiff, allChanged } from "./diff.ts";
export type { WorkspaceDiff } from "./diff.ts";
export { createEvalCopy, TreeDeadSignal } from "./evalcopy.ts";
export { listBaseFiles, restoreFromBase } from "./restore.ts";
export { killTreeAndSignal, signalIfNoOrphans } from "./treedead.ts";
export type { EnsureTreeDeadResult } from "./treedead.ts";
