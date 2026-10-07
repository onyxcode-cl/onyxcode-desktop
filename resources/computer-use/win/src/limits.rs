//! Límites del contrato (protocol.json y plan C). Todo lo que viene del llamador se acota aquí.

/// `ax-tree`: profundidad y nodos máximos (y valores por defecto).
pub const TREE_MAX_DEPTH: i64 = 12;
pub const TREE_MAX_NODES: i64 = 500;
/// `ax-find`: resultados máximos y cota del recorrido (como el helper de macOS).
pub const FIND_MAX_RESULTS: usize = 50;
pub const FIND_WALK_DEPTH: usize = 30;
pub const FIND_WALK_NODES: usize = 4000;
/// `find-elements`: nodos, coincidencias y tiempo.
pub const FIND_EL_NODES: usize = 4000;
pub const FIND_EL_MATCHES: usize = 300;
pub const FIND_EL_BUDGET_MS: u64 = 800;
/// Tiempo máximo de un recorrido de `ax-tree`/`ax-find` (el llamador corta a los 15 s).
pub const TREE_BUDGET_MS: u64 = 9_000;
/// Recorte de textos (`value`, título, descripción) en la salida.
pub const VALUE_MAX_CHARS: usize = 200;
/// `type`: tiempo total máximo y caracteres máximos por llamada.
pub const TYPE_MAX_TOTAL_MS: f64 = 4000.0;
pub const TYPE_MAX_CHARS: usize = 5000;
/// Captura: lado largo (por defecto 1366), calidad JPEG (por defecto 70) y tope absoluto de píxeles de ventana.
pub const CAPTURE_DEFAULT_LONG: i64 = 1366;
pub const CAPTURE_MIN_LONG: i64 = 100;
pub const CAPTURE_MAX_LONG: i64 = 4096;
pub const JPEG_DEFAULT_QUALITY: i64 = 70;
/// Tiempo de espera del llamador y tope de su salida (el helper nunca imprime más de `MAX_OUTPUT_BYTES`).
pub const CALLER_TIMEOUT_MS: u64 = 15_000;
pub const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
/// Rueda: líneas máximas por llamada.
pub const SCROLL_MAX_LINES: i64 = 100;
/// `mask-keys`: claves máximas y longitud total.
pub const MAX_KEYS_PER_CALL: usize = 256;
pub const MAX_ARG_CHARS: usize = 32 * 1024;

pub fn clamp_i64(v: i64, lo: i64, hi: i64) -> i64 {
    v.max(lo).min(hi)
}
