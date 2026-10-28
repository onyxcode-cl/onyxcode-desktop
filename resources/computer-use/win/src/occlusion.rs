//! Aviso de ventana tapada (informativo, NO es una barrera de seguridad: la barrera sigue siendo la comprobación
//! «¿qué app hay bajo el punto?» antes de cada clic). PURO: se prueba con `cargo test` en cualquier sistema.
//!
//! Se muestrea una rejilla `GRID`×`GRID` sobre el marco de la ventana capturada con la lista de ventanas en orden Z
//! (de delante hacia atrás, en memoria, sin llamadas por punto). En cada punto manda la primera ventana que lo contiene
//! y no deja pasar el ratón; si es la capturada o del mismo proceso, ese punto no está tapado.
//!
//! Privacidad: lo único que sale de aquí hacia la salida del helper son NOMBRES de app y porcentajes. Nunca títulos
//! de ventana, rutas, rectángulos de otras ventanas ni contenido.

use crate::mask::Rect;

/// Lado de la rejilla de muestreo (1024 puntos: cada punto vale ~0,1 %).
pub const GRID: i64 = 32;
/// Tope de apps distintas que se informan.
pub const MAX_COVERING_APPS: usize = 5;
/// Tope de caracteres del nombre de una app.
pub const MAX_LABEL_CHARS: usize = 60;
/// Nombre cuando no se pudo identificar la app que tapa.
pub const UNKNOWN_LABEL: &str = "una ventana sin identificar";

/// Ventana de la enumeración, en orden Z. Solo lo necesario para decidir quién manda en cada punto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OccWin {
    pub id: u64,
    pub pid: u32,
    pub rect: Rect,
    /// Deja pasar el ratón (`WS_EX_TRANSPARENT`) o está minimizada: no manda en ningún punto.
    pub pass_through: bool,
}

/// Puntos tapados por cada ventana de la lista (por índice) y total de puntos muestreados.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Coverage {
    pub by_window: Vec<(usize, u32)>,
    pub covered: u32,
    pub sampled: u32,
}

/// Muestrea la rejilla sobre `frame`. `None` si el marco no es válido o la capturada no aparece en la lista
/// (no se puede afirmar nada: el llamador omite el aviso en vez de inventarlo).
pub fn sample_coverage(frame: Rect, target_id: u64, target_pid: u32, wins: &[OccWin]) -> Option<Coverage> {
    if frame.w <= 0 || frame.h <= 0 || !wins.iter().any(|w| w.id == target_id) {
        return None;
    }
    let (fw, fh) = (frame.w as i64, frame.h as i64);
    let mut counts = vec![0u32; wins.len()];
    let mut covered = 0u32;
    for gy in 0..GRID {
        // Centro de la celda, en píxeles globales.
        let py = frame.y as i64 + (2 * gy + 1) * fh / (2 * GRID);
        for gx in 0..GRID {
            let px = frame.x as i64 + (2 * gx + 1) * fw / (2 * GRID);
            let top = wins.iter().position(|w| !w.pass_through && w.rect.w > 0 && w.rect.h > 0 && px >= w.rect.x as i64 && py >= w.rect.y as i64 && px < w.rect.right() && py < w.rect.bottom());
            if let Some(i) = top {
                let w = &wins[i];
                if w.id != target_id && w.pid != target_pid {
                    counts[i] += 1;
                    covered += 1;
                }
            }
        }
    }
    let by_window = counts.into_iter().enumerate().filter(|(_, n)| *n > 0).collect();
    Some(Coverage { by_window, covered, sampled: (GRID * GRID) as u32 })
}

/// Porcentaje entero 0..100; si hay algún punto, al menos 1.
pub fn pct(points: u32, sampled: u32) -> u32 {
    if points == 0 || sampled == 0 {
        return 0;
    }
    ((points as u64 * 100 + sampled as u64 / 2) / sampled as u64).clamp(1, 100) as u32
}

/// Agrupa por nombre de app (`label_of` recibe el índice de la ventana en la lista), de mayor a menor tapado.
/// Devuelve solo (nombre, porcentaje).
pub fn group_by_app(cov: &Coverage, mut label_of: impl FnMut(usize) -> String) -> Vec<(String, u32)> {
    let mut groups: Vec<(String, u32)> = Vec::new();
    for (idx, n) in &cov.by_window {
        let label = clean_label(&label_of(*idx));
        match groups.iter_mut().find(|(l, _)| *l == label) {
            Some(g) => g.1 += n,
            None => groups.push((label, *n)),
        }
    }
    groups.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    groups.truncate(MAX_COVERING_APPS);
    groups.into_iter().map(|(l, n)| (l, pct(n, cov.sampled))).collect()
}

/// Nombre apto para mostrar: sin caracteres de control, recortado; vacío → «sin identificar».
pub fn clean_label(raw: &str) -> String {
    let s: String = raw.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(MAX_LABEL_CHARS).collect();
    if s.is_empty() {
        UNKNOWN_LABEL.to_string()
    } else {
        s
    }
}

/// Nombre de una app empaquetada (UWP) SIN usar el título de la ventana: la familia del paquete del AUMID
/// (`Microsoft.WindowsCalculator_8wekyb3d8bbwe!App` → `Microsoft.WindowsCalculator`). El nombre que el helper guarda para
/// estas apps ES el título de la ventana, y el título no puede salir en `covered`.
pub fn aumid_label(aumid: &str) -> String {
    let pkg = aumid.split('!').next().unwrap_or("");
    let family = pkg.split('_').next().unwrap_or("");
    clean_label(family)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: u64, pid: u32, r: Rect) -> OccWin {
        OccWin { id, pid, rect: r, pass_through: false }
    }
    const T: Rect = Rect { x: 0, y: 0, w: 1000, h: 800 };

    #[test]
    fn sin_tapar_da_vacio() {
        let wins = [w(1, 10, T), w(2, 20, Rect::new(1000, 0, 500, 500))];
        let c = sample_coverage(T, 1, 10, &wins).unwrap();
        assert_eq!(c.covered, 0);
        assert!(c.by_window.is_empty());
        assert!(group_by_app(&c, |_| "x".into()).is_empty());
    }

    #[test]
    fn ventana_encima_al_50_por_ciento() {
        // Una ventana de otro proceso delante cubre la mitad derecha.
        let wins = [w(2, 20, Rect::new(500, 0, 500, 800)), w(1, 10, T)];
        let c = sample_coverage(T, 1, 10, &wins).unwrap();
        assert_eq!(c.covered, 512);
        let g = group_by_app(&c, |_| "Brave".into());
        assert_eq!(g, vec![("Brave".to_string(), 50)]);
        assert_eq!(pct(c.covered, c.sampled), 50);
    }

    #[test]
    fn ventana_detras_no_tapa() {
        let wins = [w(1, 10, T), w(2, 20, T)];
        assert_eq!(sample_coverage(T, 1, 10, &wins).unwrap().covered, 0);
    }

    #[test]
    fn mismo_proceso_no_cuenta() {
        // Un cuadro de diálogo del mismo proceso delante no se avisa como «otra app que tapa».
        let wins = [w(3, 10, Rect::new(0, 0, 1000, 800)), w(1, 10, T)];
        assert_eq!(sample_coverage(T, 1, 10, &wins).unwrap().covered, 0);
    }

    #[test]
    fn deja_pasar_el_raton_no_cuenta() {
        let mut ov = w(2, 20, T);
        ov.pass_through = true;
        let wins = [ov, w(1, 10, T)];
        assert_eq!(sample_coverage(T, 1, 10, &wins).unwrap().covered, 0);
    }

    #[test]
    fn minimizada_no_cuenta_y_tapa_total() {
        let mut min = w(2, 20, T);
        min.pass_through = true;
        assert_eq!(sample_coverage(T, 1, 10, &[min, w(1, 10, T)]).unwrap().covered, 0);
        let full = [w(2, 20, Rect::new(-10, -10, 2000, 2000)), w(1, 10, T)];
        let c = sample_coverage(T, 1, 10, &full).unwrap();
        assert_eq!((c.covered, pct(c.covered, c.sampled)), (1024, 100));
    }

    #[test]
    fn agrupa_por_nombre_y_ordena() {
        // Dos ventanas de la misma app suman; la otra app tapa menos.
        let wins = [
            w(2, 20, Rect::new(0, 0, 250, 800)),
            w(3, 21, Rect::new(250, 0, 250, 800)),
            w(4, 30, Rect::new(500, 0, 125, 800)),
            w(1, 10, T),
        ];
        let c = sample_coverage(T, 1, 10, &wins).unwrap();
        let g = group_by_app(&c, |i| if i < 2 { "Chrome".into() } else { "Notas".into() });
        assert_eq!(g, vec![("Chrome".to_string(), 50), ("Notas".to_string(), 13)]);
    }

    #[test]
    fn tope_de_apps_y_minimo_un_por_ciento() {
        let c = Coverage { by_window: (0..8).map(|i| (i, 1)).collect(), covered: 8, sampled: 1024 };
        let g = group_by_app(&c, |i| format!("app{i}"));
        assert_eq!(g.len(), MAX_COVERING_APPS);
        assert!(g.iter().all(|(_, p)| *p == 1));
        assert_eq!(pct(0, 1024), 0);
        assert_eq!(pct(1, 1024), 1);
    }

    #[test]
    fn ambiguo_o_invalido_da_none() {
        // La capturada no aparece en la lista: no se afirma nada.
        assert!(sample_coverage(T, 99, 10, &[w(2, 20, T)]).is_none());
        assert!(sample_coverage(Rect::new(0, 0, 0, 10), 1, 10, &[w(1, 10, T)]).is_none());
        assert!(sample_coverage(T, 1, 10, &[]).is_none());
    }

    #[test]
    fn marco_pequeno_y_negativo_no_revienta() {
        let f = Rect::new(-50, -20, 3, 2);
        let wins = [w(2, 20, Rect::new(-50, -20, 3, 1)), w(1, 10, f)];
        let c = sample_coverage(f, 1, 10, &wins).unwrap();
        assert!(c.covered > 0 && c.covered < 1024);
    }

    #[test]
    fn nombres_sin_titulos_ni_control() {
        assert_eq!(clean_label("  Goo\u{0}gle\nChrome "), "GoogleChrome");
        assert_eq!(clean_label(""), UNKNOWN_LABEL);
        assert_eq!(clean_label(&"a".repeat(500)).chars().count(), MAX_LABEL_CHARS);
        assert_eq!(aumid_label("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), "Microsoft.WindowsCalculator");
        assert_eq!(aumid_label("!App"), UNKNOWN_LABEL);
    }
}
