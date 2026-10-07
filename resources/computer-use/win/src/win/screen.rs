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

/// v1: un punto fuera del monitor principal se rechaza (código 11) con un mensaje claro.
pub fn require_on_primary(x: f64, y: f64) -> crate::exitcode::CuResult<(i32, i32)> {
    let m = primary().ok_or_else(|| crate::exitcode::CuError::unavailable("No se pudo determinar el monitor principal"))?;
    let (xi, yi) = (x.round() as i32, y.round() as i32);
    let r = m.rect;
    if xi < r.x || yi < r.y || (xi as i64) >= r.right() || (yi as i64) >= r.bottom() {
        return Err(crate::exitcode::CuError::not_allowed("Ese punto está fuera del monitor principal: Control del PC solo actúa en el principal"));
    }
    Ok((xi, yi))
}
