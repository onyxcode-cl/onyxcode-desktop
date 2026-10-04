// Binario SIMULADO de `codex exec --json`. NO es codex real.
// Uso: node fake-codex.ts <escenario> exec --json ... -
// Escenarios: ok | orphan | ratelimit | hang | slow | crash | turnfail
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  console.log("codex-cli 0.0.0-fake");
  process.exit(0);
}
const scenario = argv[0] ?? "ok";
const rest = argv.slice(1);
const home = process.env.CODEX_HOME ?? ".";
mkdirSync(home, { recursive: true });
let stdin = "";
process.stdin.on("data", (c) => (stdin += c));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const emit = (o: unknown): void => void process.stdout.write(JSON.stringify(o) + "\n");

process.on("SIGTERM", () => process.exit(0));
await new Promise((r) => process.stdin.on("end", r));
writeFileSync(join(home, "argv.json"), JSON.stringify({ argv: rest, prompt: stdin, home: process.env.HOME, keys: Object.keys(process.env).sort(), cwd: process.cwd() }));

// sonda de aislamiento (escenario "probe"): intenta leer/escribir fuera del run y guarda el resultado dentro
if (scenario === "probe") {
  const pj = JSON.parse(readFileSync(join(process.env.HOME ?? ".", "probe.json"), "utf8")) as { readPaths: string[]; writePaths: string[]; listDirs: string[] };
  const tryDo = (f: () => unknown): string => { try { f(); return "ok"; } catch (e) { return (e as NodeJS.ErrnoException).code ?? "err"; } };
  const result = {
    reads: Object.fromEntries(pj.readPaths.map((p) => [p, tryDo(() => readFileSync(p))])),
    lists: Object.fromEntries(pj.listDirs.map((p) => [p, tryDo(() => readdirSync(p))])),
    writes: Object.fromEntries(pj.writePaths.map((p) => [p, tryDo(() => writeFileSync(p, "escape"))])),
  };
  writeFileSync(join(process.env.HOME ?? ".", "probe-result.json"), JSON.stringify(result));
}

emit({ type: "thread.started", thread_id: "thr_1" });
emit({ type: "turn.started" });
if (scenario === "crash") process.exit(2);
if (scenario === "hang") await sleep(60_000);
if (scenario === "slow") for (;;) { await sleep(30); emit({ type: "item.started", item: { id: "x", type: "reasoning" } }); }
if (scenario === "ratelimit") {
  emit({ type: "error", message: "Reconnecting... 1/5 (token rate limit reached, try again in 20s)" });
  await sleep(60_000);
}
if (scenario === "turnfail") {
  emit({ type: "turn.failed", error: { message: "model refused" } });
  process.exit(1);
}
if (scenario === "orphan") spawn("sleep", ["318"], { detached: true, stdio: "ignore" }).unref();

const ws = rest[rest.indexOf("-C") + 1] ?? process.cwd();
writeFileSync(join(ws, "out.txt"), "x\n");
emit({ type: "item.completed", item: { id: "i1", type: "reasoning", text: "pensando" } });
emit({ type: "item.completed", item: { id: "i2", type: "command_execution", command: "ls", aggregated_output: "", exit_code: 0, status: "completed" } });
emit({ type: "item.completed", item: { id: "i2", type: "command_execution", command: "ls", aggregated_output: "", exit_code: 0, status: "completed" } }); // duplicado
emit({ type: "item.completed", item: { id: "i3", type: "command_execution", command: "false", exit_code: 1, status: "failed" } });
emit({ type: "item.completed", item: { id: "i4", type: "file_change", changes: [{ path: "out.txt", kind: "add" }, { path: "a.ts", kind: "update" }], status: "completed" } });
emit({ type: "item.completed", item: { id: "i5", type: "agent_message", text: "listo" } });
emit({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200, reasoning_output_tokens: 50 } });

// rollout con token_count duplicados
const dir = join(home, "sessions", "2026", "10", "03");
mkdirSync(dir, { recursive: true });
const tc = (total: object, last: object) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 200000 } } });
const t1 = { input_tokens: 400, cached_input_tokens: 0, output_tokens: 80, reasoning_output_tokens: 20, total_tokens: 480 };
const t2 = { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 200, reasoning_output_tokens: 50, total_tokens: 1200 };
writeFileSync(
  join(dir, "rollout-2026-10-03T00-00-00-thr_1.jsonl"),
  [
    tc(t1, { input_tokens: 400 }), tc(t1, { input_tokens: 400 }), // repetido
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null, rate_limits: {} } }),
    tc(t2, { input_tokens: 700 }), tc(t2, { input_tokens: 700 }),
  ].join("\n") + "\n",
);
process.exit(0);
