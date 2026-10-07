//! Sesión interactiva, escritorio seguro y consentimiento. Sin escritorio interactivo (SSH, servicio, RDP
//! desconectado, pantalla de bloqueo, UAC) no se controla nada: código 12.

use super::process;
use super::util::from_wide;
use crate::exitcode::{CuError, CuResult};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::RemoteDesktop::{WTSFreeMemory, WTSQuerySessionInformationW, WTSConnectState, WTSActive, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION};
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, GetProcessWindowStation, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS, UOI_NAME,
};

#[derive(Debug, Clone, Copy)]
pub struct SessionState {
    /// Proceso en `WinSta0` y sesión activa (consola o RDP conectado).
    pub interactive: bool,
    /// El escritorio de entrada no es `Default` (UAC, Ctrl+Alt+Supr, bloqueo) o no se puede abrir.
    pub secure_desktop: bool,
}

unsafe fn object_name(h: HANDLE) -> Option<String> {
    let mut buf = vec![0u16; 256];
    let mut need = 0u32;
    GetUserObjectInformationW(h, UOI_NAME, Some(buf.as_mut_ptr() as *mut _), (buf.len() * 2) as u32, Some(&mut need)).ok()?;
    Some(from_wide(&buf))
}

pub fn state() -> SessionState {
    unsafe {
        let station_ok = GetProcessWindowStation().ok().and_then(|h| object_name(HANDLE(h.0))).is_some_and(|n| n.eq_ignore_ascii_case("WinSta0"));
        let mut active = false;
        let mut ptr = windows::core::PWSTR::null();
        let mut len = 0u32;
        if WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), WTS_CURRENT_SESSION, WTSConnectState, &mut ptr, &mut len).is_ok() && !ptr.is_null() {
            if len as usize >= 4 {
                active = *(ptr.0 as *const i32) == WTSActive.0;
            }
            WTSFreeMemory(ptr.0 as *mut _);
        }
        let secure = match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) {
            Ok(d) => {
                let name = object_name(HANDLE(d.0));
                let _ = CloseDesktop(d);
                !name.is_some_and(|n| n.eq_ignore_ascii_case("Default"))
            }
            Err(_) => true,
        };
        SessionState { interactive: station_ok && active, secure_desktop: secure }
    }
}

/// Puerta común de todo lo que actúa sobre el escritorio: consentimiento, sesión interactiva sin escritorio seguro y
/// helper no elevado. Todo con código 12 (el contrato lo fija así en Windows).
pub fn require_control(consent: bool) -> CuResult<()> {
    if !consent {
        return Err(CuError::unavailable("Sin consentimiento de Control del PC (actívalo en Ajustes)"));
    }
    let s = state();
    if !s.interactive {
        return Err(CuError::unavailable("Sin escritorio interactivo (sesión no activa, SSH, servicio o RDP desconectado)"));
    }
    if s.secure_desktop {
        return Err(CuError::unavailable("Escritorio seguro activo (UAC, bloqueo o Ctrl+Alt+Supr): no se actúa"));
    }
    if process::self_elevated() {
        return Err(CuError::unavailable("Lazunox se ejecuta con permisos de administrador: Control del PC no está disponible"));
    }
    Ok(())
}
