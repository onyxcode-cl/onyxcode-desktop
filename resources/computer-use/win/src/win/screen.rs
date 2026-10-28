//! Monitores y DPI. El helper trabaja en PÍXELES FÍSICOS del escritorio virtual (proceso PerMonitorV2).
//! v1 actúa solo sobre el monitor principal.

use crate::mask::Rect;
use windows::core::BOOL;
use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI};

#[derive(Debug, Clone, Copy)]
pub struct Monitor {
    pub rect: Rect,
    pub main: bool,
    pub dpi: u32,
}

impl Monitor {
    pub fn scale(&self) -> f64 {
        self.dpi as f64 / 96.0
    }
}

/// Debe llamarse al arrancar, antes de cualquier otra llamada de ventanas o de entrada.
pub fn set_dpi_awareness() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
}

unsafe extern "system" fn each(h: HMONITOR, _: HDC, _: *mut RECT, lp: LPARAM) -> BOOL {
    let v = &mut *(lp.0 as *mut Vec<Monitor>);
    let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    if GetMonitorInfoW(h, &mut mi).as_bool() {
        let r = mi.rcMonitor;
        let (mut dx, mut dy) = (96u32, 96u32);
        let _ = GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut dx, &mut dy);
        v.push(Monitor { rect: Rect::new(r.left, r.top, r.right - r.left, r.bottom - r.top), main: mi.dwFlags & 1 != 0, dpi: dx.max(96) });
    }
    BOOL(1)
}

/// Todos los monitores, el principal primero.
pub fn monitors() -> Vec<Monitor> {
    let mut v: Vec<Monitor> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut v as *mut _ as isize));
    }
    v.sort_by_key(|m| !m.main);
    v
}

pub fn primary() -> Option<Monitor> {
    monitors().into_iter().find(|m| m.main)
}

/// Punto (redondeado) dentro de ALGÚN rectángulo de la lista; las coordenadas pueden ser negativas (monitor a la izquierda/arriba del
/// principal). Función pura para poder probarla sin monitores reales.
pub fn point_in_any(rects: &[crate::mask::Rect], x: f64, y: f64) -> Option<(i32, i32)> {
    let (xi, yi) = (x.round() as i32, y.round() as i32);
    rects
        .iter()
        .any(|r| xi >= r.x && yi >= r.y && (xi as i64) < r.right() && (yi as i64) < r.bottom())
        .then_some((xi, yi))
}

/// El punto tiene que caer dentro de ALGÚN monitor real (código 11 si cae en un hueco entre monitores o fuera de todos).
/// Sustituye a la antigua restricción «solo monitor principal»; `require_point_controllable` sigue comprobando la app bajo el punto.
pub fn require_on_monitor(x: f64, y: f64) -> crate::exitcode::CuResult<(i32, i32)> {
    let rects: Vec<crate::mask::Rect> = monitors().iter().map(|m| m.rect).collect();
    if rects.is_empty() {
        return Err(crate::exitcode::CuError::unavailable("No se pudo determinar los monitores"));
    }
    point_in_any(&rects, x, y).ok_or_else(|| crate::exitcode::CuError::not_allowed("Ese punto está fuera de todos los monitores"))
}

#[cfg(test)]
mod tests {
    use super::point_in_any;
    use crate::mask::Rect;

    // Principal 1920x1080 en (0,0) y secundario a la izquierda con origen negativo, más bajo (hueco vertical sobre él).
    fn mons() -> Vec<Rect> {
        vec![Rect::new(0, 0, 1920, 1080), Rect::new(-1280, 100, 1280, 1024)]
    }

    #[test]
    fn acepta_punto_en_monitor_secundario_con_origen_negativo() {
        assert_eq!(point_in_any(&mons(), -1000.0, 500.0), Some((-1000, 500)));
        assert_eq!(point_in_any(&mons(), -1280.0, 100.0), Some((-1280, 100)));
    }

    #[test]
    fn acepta_punto_en_el_principal() {
        assert_eq!(point_in_any(&mons(), 10.4, 20.6), Some((10, 21)));
    }

    #[test]
    fn rechaza_hueco_entre_monitores_y_fuera_de_todos() {
        assert_eq!(point_in_any(&mons(), -1000.0, 50.0), None); // encima del secundario, que empieza en y=100
        assert_eq!(point_in_any(&mons(), 1920.0, 10.0), None); // borde derecho exclusivo
        assert_eq!(point_in_any(&mons(), -1281.0, 500.0), None);
        assert_eq!(point_in_any(&mons(), 0.0, 1080.0), None);
        assert_eq!(point_in_any(&[], 0.0, 0.0), None);
    }
}
