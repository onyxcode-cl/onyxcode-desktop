//! Movimiento «humano» del ratón y planificación del tecleo: matemática PURA (sin Windows).
//! El helper de macOS usa la misma curva (Bézier arqueada con perfil de mínimo jerk, 250–600 ms, ~120 Hz).

use crate::limits::{SCROLL_MAX_LINES, TYPE_MAX_CHARS, TYPE_MAX_TOTAL_MS};

/// Generador pseudoaleatorio mínimo (xorshift64*), sin dependencias. NO es criptográfico ni lo necesita.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }
    pub fn from_clock() -> Self {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
        Rng::new(t ^ ((std::process::id() as u64) << 32))
    }
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniforme en [lo, hi).
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64 * (hi - lo)
    }
    pub fn coin(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

/// Duración (s) de la animación según la distancia (misma fórmula que `service.ts`/`overlay.ts`).
pub fn motion_duration(dist: f64) -> f64 {
    0.25 + 0.35 * (dist / 1400.0).min(1.0)
}

/// Perfil de velocidad de mínimo jerk.
pub fn min_jerk(t: f64) -> f64 {
    t * t * t * (10.0 - 15.0 * t + 6.0 * t * t)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Waypoint {
    pub x: i32,
    pub y: i32,
    /// Instante objetivo desde el inicio del movimiento (ms).
    pub at_ms: f64,
}

pub const HZ: f64 = 120.0;

/// Trayectoria de `a` a `b`. Con `instant` o distancia < 3 px: un único punto. El último punto es SIEMPRE `b`.
pub fn glide_path(a: (f64, f64), b: (f64, f64), instant: bool, rng: &mut Rng) -> Vec<Waypoint> {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let dist = (dx * dx + dy * dy).sqrt();
    let end = Waypoint { x: b.0.round() as i32, y: b.1.round() as i32, at_ms: 0.0 };
    if instant || dist < 3.0 {
        return vec![end];
    }
    let side = if rng.coin() { 1.0 } else { -1.0 };
    let bend = (dist * rng.range(0.04, 0.12)).min(90.0) * side;
    let mx = (a.0 + b.0) / 2.0 - dy / dist * bend;
    let my = (a.1 + b.1) / 2.0 + dx / dist * bend;
    let duration = motion_duration(dist);
    let frames = std::cmp::max(8, (duration * HZ) as usize);
    (1..=frames)
        .map(|i| {
            let t = min_jerk(i as f64 / frames as f64);
            let u = 1.0 - t;
            let at_ms = i as f64 * 1000.0 / HZ;
            if i == frames {
                return Waypoint { at_ms, ..end };
            }
            Waypoint {
                x: (u * u * a.0 + 2.0 * u * t * mx + t * t * b.0).round() as i32,
                y: (u * u * a.1 + 2.0 * u * t * my + t * t * b.1).round() as i32,
                at_ms,
            }
        })
        .collect()
}

/// Rueda en «clics» de 120 (WHEEL_DELTA): `dy > 0` = hacia abajo y `dx > 0` = a la derecha, como en macOS.
/// En Windows la rueda vertical positiva sube, así que se invierte `dy`.
pub fn wheel_deltas(dx: f64, dy: f64) -> (i32, i32) {
    let cl = |v: f64| (v.round() as i64).clamp(-SCROLL_MAX_LINES, SCROLL_MAX_LINES) as i32;
    let conv = |lines: i32| lines * 120;
    (conv(cl(dx)), conv(-cl(dy)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeStep {
    /// Unidades UTF-16 de UN carácter (un par sustituto va junto).
    Units(Vec<u16>),
    Enter,
    Tab,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedStep {
    pub step: TypeStep,
    /// Pausa tras el paso (ms).
    pub delay_ms: f64,
}

/// Plan de tecleo: `\n`, `\r` y `\r\n` = Enter real; `\t` = Tab real; los demás controles se descartan.
/// Con `instant` no hay pausas. El tiempo TOTAL de pausas nunca supera 4 s (se reescala si hace falta).
pub fn plan_type(text: &str, char_delay_ms: f64, instant: bool, rng: &mut Rng) -> Result<Vec<PlannedStep>, String> {
    if text.chars().count() > TYPE_MAX_CHARS {
        return Err(format!("Texto demasiado largo (máximo {TYPE_MAX_CHARS} caracteres por llamada)"));
    }
    let mut steps: Vec<(TypeStep, char)> = Vec::new();
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            '\r' => {
                if it.peek() == Some(&'\n') {
                    it.next();
                }
                steps.push((TypeStep::Enter, '\n'));
            }
            '\n' => steps.push((TypeStep::Enter, '\n')),
            '\t' => steps.push((TypeStep::Tab, '\t')),
            c if (c as u32) < 0x20 || (0x7f..0xa0).contains(&(c as u32)) => {}
            c => {
                let mut b = [0u16; 2];
                steps.push((TypeStep::Units(c.encode_utf16(&mut b).to_vec()), c));
            }
        }
    }
    let n = steps.len().max(1) as f64;
    let base = if instant { 0.0 } else { char_delay_ms.max(0.0).min(TYPE_MAX_TOTAL_MS / n) };
    let mut planned: Vec<PlannedStep> = steps
        .into_iter()
        .map(|(step, ch)| {
            let mut ms = 0.0;
            if base > 0.0 {
                ms = base * rng.range(0.6, 1.4);
                if ch == ' ' || ch == ',' || ch == '.' {
                    ms += base * 0.8;
                }
            }
            PlannedStep { step, delay_ms: ms }
        })
        .collect();
    let total: f64 = planned.iter().map(|p| p.delay_ms).sum();
    if total > TYPE_MAX_TOTAL_MS {
        let k = TYPE_MAX_TOTAL_MS / total;
        planned.iter_mut().for_each(|p| p.delay_ms *= k);
    }
    Ok(planned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duracion_y_jerk() {
        assert!((motion_duration(0.0) - 0.25).abs() < 1e-9);
        assert!((motion_duration(5000.0) - 0.6).abs() < 1e-9);
        assert_eq!(min_jerk(0.0), 0.0);
        assert!((min_jerk(1.0) - 1.0).abs() < 1e-12);
        assert!((min_jerk(0.5) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn trayectoria_termina_en_destino_y_es_monotona_en_el_tiempo() {
        let mut rng = Rng::new(42);
        for (a, b) in [((0.0, 0.0), (1000.0, 700.0)), ((500.0, 500.0), (-30.0, 20.0)), ((10.0, 10.0), (12.0, 11.0))] {
            let p = glide_path(a, b, false, &mut rng);
            let last = p.last().unwrap();
            assert_eq!((last.x, last.y), (b.0.round() as i32, b.1.round() as i32));
            assert!(p.windows(2).all(|w| w[1].at_ms >= w[0].at_ms));
            let dist = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
            if dist >= 3.0 {
                assert!(p.len() >= 8);
                assert!(last.at_ms >= 250.0 && last.at_ms <= 620.0, "{}", last.at_ms);
            } else {
                assert_eq!(p.len(), 1);
            }
        }
        assert_eq!(glide_path((0.0, 0.0), (900.0, 900.0), true, &mut rng).len(), 1);
    }

    #[test]
    fn rueda() {
        assert_eq!(wheel_deltas(0.0, 3.0), (0, -360));
        assert_eq!(wheel_deltas(2.0, -1.0), (240, 120));
        assert_eq!(wheel_deltas(0.0, 1e9), (0, -12000));
    }

    #[test]
    fn plan_de_tecleo() {
        let mut rng = Rng::new(7);
        let p = plan_type("a\tb\r\nc\nñ😀\u{0}\u{1b}", 14.0, false, &mut rng).unwrap();
        let kinds: Vec<_> = p.iter().map(|s| s.step.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                TypeStep::Units(vec![b'a' as u16]),
                TypeStep::Tab,
                TypeStep::Units(vec![b'b' as u16]),
                TypeStep::Enter,
                TypeStep::Units(vec![b'c' as u16]),
                TypeStep::Enter,
                TypeStep::Units(vec!['ñ' as u16]),
                TypeStep::Units(vec![0xD83D, 0xDE00]),
            ]
        );
        assert!(p.iter().all(|s| s.delay_ms > 0.0));
    }

    #[test]
    fn tecleo_instantaneo_sin_pausas_y_tope_de_4_segundos() {
        let mut rng = Rng::new(1);
        let inst = plan_type("hola, mundo.", 14.0, true, &mut rng).unwrap();
        assert!(inst.iter().all(|s| s.delay_ms == 0.0));
        for delay in [14.0, 50.0, 500.0, 1e9] {
            let text = "a b, c. ".repeat(500);
            let p = plan_type(&text, delay, false, &mut rng).unwrap();
            let total: f64 = p.iter().map(|s| s.delay_ms).sum();
            assert!(total <= TYPE_MAX_TOTAL_MS + 1e-6, "{delay}: {total}");
        }
        assert!(plan_type(&"x".repeat(TYPE_MAX_CHARS + 1), 14.0, false, &mut rng).is_err());
        assert!(plan_type("", 14.0, false, &mut rng).unwrap().is_empty());
    }
}
