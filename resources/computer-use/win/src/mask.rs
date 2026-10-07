//! Máscara de las capturas con orden Z (espejo de `planMasks`/`windowsChanged`/`masksToCapturePx` de
//! `src/main/computer/policy/geometry.ts`) y utilidades de píxeles. PURO.
//! FALLA CERRADO: enumeración fallida, rectángulos inválidos o imposibilidad de enmascarar → sin captura.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Rect { x, y, w, h }
    }
    pub fn right(&self) -> i64 {
        self.x as i64 + self.w as i64
    }
    pub fn bottom(&self) -> i64 {
        self.y as i64 + self.h as i64
    }
    pub fn valid(&self) -> bool {
        self.w >= 0 && self.h >= 0
    }
}

pub fn intersect(a: Rect, b: Rect) -> Option<Rect> {
    let x = a.x.max(b.x) as i64;
    let y = a.y.max(b.y) as i64;
    let r = a.right().min(b.right());
    let bt = a.bottom().min(b.bottom());
    if r > x && bt > y {
        Some(Rect { x: x as i32, y: y as i32, w: (r - x) as i32, h: (bt - y) as i32 })
    } else {
        None
    }
}

/// `a` menos `b`: hasta 4 rectángulos que cubren exactamente la parte de `a` no tapada por `b`.
pub fn subtract(a: Rect, b: Rect) -> Vec<Rect> {
    let Some(i) = intersect(a, b) else { return vec![a] };
    let mut out = Vec::new();
    if i.y > a.y {
        out.push(Rect::new(a.x, a.y, a.w, i.y - a.y));
    }
    if i.bottom() < a.bottom() {
        out.push(Rect::new(a.x, i.y + i.h, a.w, (a.bottom() - i.bottom()) as i32));
    }
    if i.x > a.x {
        out.push(Rect::new(a.x, i.y, i.x - a.x, i.h));
    }
    if i.right() < a.right() {
        out.push(Rect::new(i.x + i.w, i.y, (a.right() - i.right()) as i32, i.h));
    }
    out
}

/// Ventana visible de la enumeración (de delante hacia atrás).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WinInfo {
    pub id: u64,
    /// Extensión completa de la ventana (la que se tapa si no está concedida).
    pub rect: Rect,
    /// Extensión OPACA (la que cubre lo de detrás): marco visible sin sombras.
    pub cover: Rect,
    /// ¿Concedida o exenta? Cualquier otra cosa (bloqueada, elevada, desconocida, sin concesión) es `false`.
    pub granted: bool,
    /// ¿Es opaca? Una concedida translúcida (WS_EX_LAYERED/TRANSPARENT) NO cubre lo que tiene detrás.
    pub opaque: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MaskPlan {
    Ok(Vec<Rect>),
    Fail(String),
}

pub fn plan_masks(windows: Option<&[WinInfo]>, bounds: Rect, can_mask: bool) -> MaskPlan {
    let Some(windows) = windows else {
        return MaskPlan::Fail("No se pudo enumerar las ventanas: sin captura (falla cerrado)".into());
    };
    if !bounds.valid() || bounds.w <= 0 || bounds.h <= 0 {
        return MaskPlan::Fail("Zona de captura no válida".into());
    }
    let mut masks: Vec<Rect> = Vec::new();
    for (i, w) in windows.iter().enumerate() {
        if w.granted {
            continue;
        }
        if !w.rect.valid() {
            return MaskPlan::Fail("Una ventana no concedida tiene un rectángulo no válido: sin captura (falla cerrado)".into());
        }
        let Some(visible) = intersect(w.rect, bounds) else { continue };
        let mut pieces = vec![visible];
        for j in windows.iter().take(i) {
            if !j.granted || !j.opaque || !j.cover.valid() {
                continue;
            }
            pieces = pieces.into_iter().flat_map(|p| subtract(p, j.cover)).collect();
            if pieces.is_empty() {
                break;
            }
        }
        masks.extend(pieces);
    }
    if !masks.is_empty() && !can_mask {
        return MaskPlan::Fail("Hay ventanas sin concesión y no se pueden enmascarar: sin captura (falla cerrado)".into());
    }
    MaskPlan::Ok(masks)
}

/// La enumeración antes y después de capturar debe coincidir (ids, orden, rectángulos y concesión).
pub fn windows_changed(before: &[WinInfo], after: &[WinInfo]) -> bool {
    before != after
}

/// Pinta de negro (BGRA opaco) los rectángulos en un búfer de `width`×`height` píxeles de 4 bytes. Recorta a los
/// límites. Devuelve cuántos rectángulos tocaron la imagen.
pub fn fill_black(buf: &mut [u8], width: usize, height: usize, rects: &[Rect]) -> usize {
    assert!(buf.len() >= width * height * 4);
    let mut n = 0;
    for r in rects {
        let x0 = r.x.max(0) as i64;
        let y0 = r.y.max(0) as i64;
        let x1 = r.right().min(width as i64);
        let y1 = r.bottom().min(height as i64);
        if x1 <= x0 || y1 <= y0 {
            continue;
        }
        n += 1;
        for y in y0..y1 {
            let row = (y as usize * width + x0 as usize) * 4;
            let len = (x1 - x0) as usize * 4;
            for px in buf[row..row + len].chunks_exact_mut(4) {
                px.copy_from_slice(&[0, 0, 0, 255]);
            }
        }
    }
    n
}

/// Tamaño de la captura enviada al modelo (lado largo ≤ `max_long`, sin ampliar) y razón físico/captura.
pub fn capture_size(phys_w: i64, phys_h: i64, max_long: i64) -> Option<(u32, u32, f64)> {
    if phys_w <= 0 || phys_h <= 0 {
        return None;
    }
    let k = (max_long as f64 / phys_w.max(phys_h) as f64).min(1.0);
    let w = ((phys_w as f64 * k).round() as i64).max(1);
    let h = ((phys_h as f64 * k).round() as i64).max(1);
    Some((w as u32, h as u32, phys_w as f64 / w as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    const B: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };
    fn win(id: u64, r: Rect, granted: bool) -> WinInfo {
        WinInfo { id, rect: r, cover: r, granted, opaque: true }
    }
    fn area(v: &[Rect]) -> i64 {
        v.iter().map(|r| r.w as i64 * r.h as i64).sum()
    }

    #[test]
    fn fallar_cerrado() {
        assert!(matches!(plan_masks(None, B, true), MaskPlan::Fail(_)));
        assert!(matches!(plan_masks(Some(&[]), Rect::new(0, 0, 0, 10), true), MaskPlan::Fail(_)));
        let w = [win(1, Rect::new(10, 10, 100, 100), false)];
        assert!(matches!(plan_masks(Some(&w), B, false), MaskPlan::Fail(_)));
        assert_eq!(plan_masks(Some(&w), B, true), MaskPlan::Ok(vec![Rect::new(10, 10, 100, 100)]));
        let bad = [win(1, Rect::new(10, 10, -1, 5), false)];
        assert!(matches!(plan_masks(Some(&bad), B, true), MaskPlan::Fail(_)));
        assert_eq!(plan_masks(Some(&[]), B, false), MaskPlan::Ok(vec![]));
        let granted = [win(1, Rect::new(0, 0, 50, 50), true)];
        assert_eq!(plan_masks(Some(&granted), B, false), MaskPlan::Ok(vec![]));
    }

    #[test]
    fn concedida_encima_de_no_concedida_no_se_tapa() {
        // Delante (índice 0) una concedida; detrás una no concedida que la rodea.
        let front = win(1, Rect::new(100, 100, 200, 200), true);
        let back = win(2, Rect::new(0, 0, 500, 500), false);
        let MaskPlan::Ok(m) = plan_masks(Some(&[front.clone(), back.clone()]), B, true) else { panic!() };
        assert_eq!(area(&m), 500 * 500 - 200 * 200);
        assert!(m.iter().all(|r| intersect(*r, front.rect).is_none()));
        // Al revés: la no concedida está delante → se tapa entera aunque detrás haya una concedida.
        let MaskPlan::Ok(m2) = plan_masks(Some(&[back, front]), B, true) else { panic!() };
        assert_eq!(area(&m2), 500 * 500);
    }

    #[test]
    fn concedida_translucida_no_destapa() {
        let mut front = win(1, Rect::new(100, 100, 200, 200), true);
        front.opaque = false;
        let back = win(2, Rect::new(0, 0, 500, 500), false);
        let MaskPlan::Ok(m) = plan_masks(Some(&[front, back]), B, true) else { panic!() };
        assert_eq!(area(&m), 500 * 500);
    }

    #[test]
    fn se_recorta_a_la_zona_capturada() {
        let off = [win(1, Rect::new(2000, 0, 300, 300), false), win(2, Rect::new(-100, -100, 200, 200), false)];
        let MaskPlan::Ok(m) = plan_masks(Some(&off), B, true) else { panic!() };
        assert_eq!(m, vec![Rect::new(0, 0, 100, 100)]);
    }

    #[test]
    fn resta_de_rectangulos_exacta() {
        let a = Rect::new(0, 0, 10, 10);
        for b in [Rect::new(2, 2, 3, 3), Rect::new(-5, -5, 8, 8), Rect::new(8, 8, 10, 10), Rect::new(0, 0, 10, 10), Rect::new(20, 20, 1, 1)] {
            let pieces = subtract(a, b);
            let inter = intersect(a, b).map(|i| i.w as i64 * i.h as i64).unwrap_or(0);
            assert_eq!(area(&pieces), 100 - inter);
            for p in &pieces {
                assert!(intersect(*p, b).is_none());
            }
        }
    }

    #[test]
    fn cambios_entre_enumeraciones() {
        let a = vec![win(1, Rect::new(0, 0, 10, 10), true), win(2, Rect::new(5, 5, 10, 10), false)];
        assert!(!windows_changed(&a, &a.clone()));
        let mut b = a.clone();
        b[1].granted = true;
        assert!(windows_changed(&a, &b));
        let mut c = a.clone();
        c[0].rect.x = 1;
        assert!(windows_changed(&a, &c));
        assert!(windows_changed(&a, &a[..1]));
        let mut d = a.clone();
        d.swap(0, 1);
        assert!(windows_changed(&a, &d));
    }

    #[test]
    fn pintar_de_negro() {
        let (w, h) = (6usize, 4usize);
        let mut buf = vec![200u8; w * h * 4];
        let n = fill_black(&mut buf, w, h, &[Rect::new(1, 1, 2, 2), Rect::new(-3, -3, 4, 4), Rect::new(10, 10, 5, 5)]);
        assert_eq!(n, 2);
        let px = |x: usize, y: usize| &buf[(y * w + x) * 4..(y * w + x) * 4 + 4];
        assert_eq!(px(1, 1), &[0, 0, 0, 255]);
        assert_eq!(px(2, 2), &[0, 0, 0, 255]);
        assert_eq!(px(0, 0), &[0, 0, 0, 255]);
        assert_eq!(px(3, 3), &[200, 200, 200, 200]);
        assert_eq!(px(5, 0), &[200, 200, 200, 200]);
    }

    #[test]
    fn tamano_de_captura() {
        assert_eq!(capture_size(2560, 1440, 1366), Some((1366, 768, 2560.0 / 1366.0)));
        assert_eq!(capture_size(800, 600, 1366), Some((800, 600, 1.0)));
        assert_eq!(capture_size(0, 600, 1366), None);
        let (w, h, r) = capture_size(3840, 2160, 1366).unwrap();
        assert_eq!((w, h), (1366, 768));
        assert!((r - 3840.0 / 1366.0).abs() < 1e-9);
    }
}
