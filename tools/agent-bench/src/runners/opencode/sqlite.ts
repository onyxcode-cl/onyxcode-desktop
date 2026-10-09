import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OcMessage, OcSessionNode } from "./types.ts";

export interface RunDb {
  path: string;
  sessions: OcSessionNode[];
  messagesBySession: Record<string, OcMessage[]>;
  warnings: string[];
}

export function findDbPath(xdgDataHome: string): string | null {
  const dir = join(xdgDataHome, "opencode");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^opencode.*\.db$/.test(f)).sort();
  return files.length ? join(dir, files[0] as string) : null;
}

type Row = Record<string, unknown>;

function columns(db: DatabaseSync, table: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name));
  } catch {
    return [];
  }
}

const pick = (cols: string[], ...names: string[]): string | null => names.find((n) => cols.includes(n)) ?? null;

function parseData(v: unknown): Row {
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? (o as Row) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Lee la sqlite propia del run (solo lectura). Esquema NV: se descubren columnas
 * con PRAGMA y se emiten avisos si no coincide con lo esperado
 * (session[id,parent_id], message[id,session_id,data], part[id,message_id,session_id,data]).
 */
export function readRunDb(dbPath: string, rootSessionId: string): RunDb {
  const warnings: string[] = [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sc = columns(db, "session");
    const mc = columns(db, "message");
    const pc = columns(db, "part");
    if (!sc.length || !mc.length || !pc.length) {
      warnings.push(`sqlite: faltan tablas esperadas (session=${sc.length} message=${mc.length} part=${pc.length})`);
      return { path: dbPath, sessions: [], messagesBySession: {}, warnings };
    }
    const sParent = pick(sc, "parent_id", "parentID", "parent_session_id");
    if (!sParent) warnings.push("sqlite: session sin columna de padre; subagentes no detectables");
    const mSess = pick(mc, "session_id", "sessionID");
    const pMsg = pick(pc, "message_id", "messageID");
    const mData = pick(mc, "data");
    const pData = pick(pc, "data");
    if (!mSess || !pMsg || !mData || !pData) {
      warnings.push("sqlite: message/part sin columnas session_id/message_id/data");
      return { path: dbPath, sessions: [], messagesBySession: {}, warnings };
    }
    const sessRows = db.prepare(`SELECT id${sParent ? `, ${sParent} AS parent` : ""} FROM session`).all() as Row[];
    const parentOf = new Map<string, string | null>();
    for (const r of sessRows) parentOf.set(String(r.id), sParent && r.parent != null ? String(r.parent) : null);
    // árbol bajo la raíz
    const tree: string[] = [rootSessionId];
    for (let i = 0; i < tree.length; i++) for (const [id, p] of parentOf) if (p === tree[i] && !tree.includes(id)) tree.push(id);
    if (!parentOf.has(rootSessionId)) warnings.push("sqlite: sesión raíz no encontrada en la tabla session");

    const order = pick(mc, "time_created", "created_at", "id") ?? "id";
    const pOrder = pick(pc, "time_created", "created_at", "id") ?? "id";
    const msgStmt = db.prepare(`SELECT id, ${mData} AS data FROM message WHERE ${mSess} = ? ORDER BY ${order}`);
    const partStmt = db.prepare(`SELECT ${pData} AS data FROM part WHERE ${pMsg} = ? ORDER BY ${pOrder}`);
    const messagesBySession: Record<string, OcMessage[]> = {};
    for (const sid of tree) {
      messagesBySession[sid] = (msgStmt.all(sid) as Row[]).map((m) => ({
        info: { id: m.id, ...parseData(m.data) },
        parts: (partStmt.all(m.id as string) as Row[]).map((p) => parseData(p.data)),
      }));
    }
    return { path: dbPath, sessions: tree.map((id) => ({ id, parentId: parentOf.get(id) ?? null })), messagesBySession, warnings };
  } finally {
    db.close();
  }
}
