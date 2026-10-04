// Utilidades compartidas por los ficheros engine*.test.ts (cada fichero corre en su propio proceso).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { loadScenarios } from "../../src/engine/config.ts";
import type { RunExperimentOptions } from "../../src/engine/engine.ts";
import { openStore } from "../../src/store/index.ts";
import type { Store } from "../../src/store/index.ts";
import { BENCH_ROOT, CASES, cfg, rmDir, routerRunner, tmpDir } from "./helpers.ts";
import type { RouterOptions } from "./helpers.ts";

export const scenarios = loadScenarios(BENCH_ROOT, [...CASES]);
const dirs: string[] = [];

export function env(): { store: Store; runBase: string } {
  const root = tmpDir();
  dirs.push(root);
  return { store: openStore(join(root, "results")), runBase: join(root, "r") };
}

export function opts(e: { store: Store; runBase: string }, ro: RouterOptions, extra: Partial<RunExperimentOptions> = {}, runnerId = "fake"): RunExperimentOptions {
  return {
    store: e.store, runBase: e.runBase, benchRoot: BENCH_ROOT, scenarios, handleSignals: false,
    configurations: [cfg("cfg-ref", runnerId), cfg("cfg-cheat", runnerId)],
    runners: { [runnerId]: routerRunner({ id: runnerId, ...ro }) },
    ...extra,
  };
}

export const byCfg = <T extends { configurationId: string }>(rs: T[], id: string): T[] => rs.filter((r) => r.configurationId === id);
export const noRunDirsLeft = (runBase: string): boolean => !existsSync(runBase) || readdirSync(runBase).length === 0;

after(() => rmDir(...dirs));
