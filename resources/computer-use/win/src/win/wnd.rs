//! Ventanas de nivel superior y su identidad de app (clave, nombre, integridad, bloqueo).
//! EnumWindows recorre de DELANTE hacia ATRÁS (orden Z).

use super::process::{self, Integrity};
use super::util::{from_wide, wide};
use crate::appkey::{self, AppKey};
use crate::blocklist;
use crate::mask::Rect;
use std::collections::HashMap;
use windows::core::{BOOL, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowRect,
    GetWindowTextW, IsIconic, IsWindowVisible, GA_ROOT, GWL_EXSTYLE, GW_OWNER, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

pub const CLASS_CORE_WINDOW: &str = "Windows.UI.Core.CoreWindow";
const FRAME_HOST: &str = "applicationframehost.exe";

#[derive(Debug, Clone)]
pub struct AppInfo {
    pub pid: u32,
    pub name: String,
    /// Clave canónica (`exe:…|pub:…` o `aumid:…`); vacía si no se pudo construir (se trata como no controlable).
    pub key: String,
    pub parsed: Option<AppKey>,
    pub exe: String,
    pub aumid: Option<String>,
    pub integrity: Integrity,
}

impl AppInfo {
    /// Bloqueada por lista o por integridad alta/desconocida o por no tener clave: NUNCA se controla.
    pub fn blocked(&self) -> bool {
        !self.integrity.controllable() || self.parsed.as_ref().is_none_or(blocklist::key_blocked) || self.key.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct TopWindow {
    pub hwnd: HWND,
    pub pid: u32,
    pub rect: Rect,
    /// Marco visible sin sombras (DWM); si falla, el rectángulo normal.
    pub frame: Rect,
    pub title: String,
    pub class: String,
    pub ex_style: u32,
    pub iconic: bool,
    pub owned: bool,
}

impl TopWindow {
    pub fn layered_or_transparent(&self) -> bool {
        self.ex_style & (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) != 0
    }
    pub fn click_through(&self) -> bool {
        self.ex_style & WS_EX_TRANSPARENT.0 != 0
    }
    pub fn tool(&self) -> bool {
        self.ex_style & WS_EX_TOOLWINDOW.0 != 0
    }
}

pub fn class_name(hwnd: HWND) -> String {
    let mut b = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, &mut b) };
    String::from_utf16_lossy(&b[..n.max(0) as usize])
}

pub fn title(hwnd: HWND) -> String {
    let mut b = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut b) };
    String::from_utf16_lossy(&b[..n.max(0) as usize])
}

fn rect_of(r: RECT) -> Rect {
    Rect::new(r.left, r.top, (r.right - r.left).max(0), (r.bottom - r.top).max(0))
}

fn describe(hwnd: HWND) -> Option<TopWindow> {
    unsafe {
        let mut r = RECT::default();
        GetWindowRect(hwnd, &mut r).ok()?;
        let rect = rect_of(r);
        let mut fr = RECT::default();
        let frame = if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut fr as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32).is_ok() {
            rect_of(fr)
        } else {
            rect
        };
        Some(TopWindow {
            hwnd,
            pid: process::pid_of(hwnd),
            rect,
            frame,
            title: title(hwnd),
            class: class_name(hwnd),
            ex_style: GetWindowLongW(hwnd, GWL_EXSTYLE) as u32,
            iconic: IsIconic(hwnd).as_bool(),
            owned: GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid()),
        })
    }
}

fn cloaked(hwnd: HWND) -> bool {
    let mut v = 0u32;
    unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut v as *mut _ as *mut _, 4).is_ok() && v != 0 }
}

unsafe extern "system" fn collect(hwnd: HWND, lp: LPARAM) -> BOOL {
    let v = &mut *(lp.0 as *mut Vec<HWND>);
    v.push(hwnd);
    BOOL(1)
}

/// Todas las ventanas de nivel superior VISIBLES (minimizadas incluidas, tapadas por DWM no), de delante hacia atrás.
/// Err si la enumeración falla (el llamador falla cerrado).
pub fn enum_top(include_iconic: bool) -> Result<Vec<TopWindow>, String> {
    let mut hs: Vec<HWND> = Vec::new();
    unsafe {
        EnumWindows(Some(collect), LPARAM(&mut hs as *mut _ as isize)).map_err(|e| format!("EnumWindows: {e}"))?;
    }
    let mut out = Vec::new();
    for h in hs {
        unsafe {
            if !IsWindowVisible(h).as_bool() || cloaked(h) {
                continue;
            }
        }
        if let Some(w) = describe(h) {
            if w.iconic && !include_iconic {
                continue;
            }
            out.push(w);
        }
    }
    Ok(out)
}

struct Probe {
    pid: u32,
    found: Option<u32>,
}

unsafe extern "system" fn find_core(hwnd: HWND, lp: LPARAM) -> BOOL {
    let p = &mut *(lp.0 as *mut Probe);
    if class_name(hwnd) == CLASS_CORE_WINDOW {
        let pid = process::pid_of(hwnd);
        if pid != p.pid {
            p.found = Some(pid);
            return BOOL(0);
        }
    }
    BOOL(1)
}

/// Caché de identidades por PID durante UNA ejecución (el editor se verifica una sola vez por ejecutable).
#[derive(Default)]
pub struct AppCache {
    by_pid: HashMap<u32, Option<AppInfo>>,
    publishers: HashMap<String, Option<String>>,
    names: HashMap<String, String>,
    /// Si es `Some`, el editor (Authenticode, caro: hay que leer todo el ejecutable) solo se verifica para estas rutas
    /// normalizadas. Las demás apps salen con el editor «(sin firma)»: no pueden coincidir con ninguna clave de interés
    /// (la ruta ya difiere), así que la comparación sigue siendo exacta y barata.
    interest: Option<std::collections::HashSet<String>>,
}

impl AppCache {
    /// Limita la verificación del editor a las rutas de estas claves (ver `interest`).
    pub fn set_interest(&mut self, keys: &[AppKey]) {
        self.interest = Some(
            keys.iter()
                .filter_map(|k| match k {
                    AppKey::Exe { path, .. } => Some(path.clone()),
                    AppKey::Aumid(_) => None,
                })
                .collect(),
        );
    }

    fn publisher(&mut self, path: &str) -> Option<String> {
        self.publishers.entry(path.to_string()).or_insert_with(|| process::publisher(path)).clone()
    }

    fn display_name(&mut self, path: &str) -> String {
        self.names
            .entry(path.to_string())
            .or_insert_with(|| {
                file_description(path).unwrap_or_else(|| {
                    let base = appkey::exe_base_name(&path.replace('/', "\\").to_lowercase()).to_string();
                    base.strip_suffix(".exe").unwrap_or(&base).to_string()
                })
            })
            .clone()
    }

    /// Identidad de la app dueña de un PID (ya resuelto el caso UWP si `real_pid` lo trae).
    pub fn info_for_pid(&mut self, pid: u32, window_title: &str) -> Option<AppInfo> {
        if let Some(c) = self.by_pid.get(&pid) {
            return c.clone();
        }
        let info = self.build(pid, window_title);
        self.by_pid.insert(pid, info.clone());
        info
    }

    fn build(&mut self, pid: u32, window_title: &str) -> Option<AppInfo> {
        let exe = process::exe_path(pid)?;
        let integrity = process::integrity(pid);
        let aumid = process::aumid(pid);
        let norm = appkey::normalize_exe_path(&exe).ok();
        let mut name = self.display_name(&exe);
        let key = if let Some(a) = &aumid {
            if !window_title.is_empty() {
                name = window_title.to_string();
            }
            appkey::aumid_key(a).ok()
        } else if let Some(n) = &norm {
            let verify = self.interest.as_ref().is_none_or(|s| s.contains(n));
            let publisher = if verify { self.publisher(&exe) } else { None };
            appkey::exe_key(n, publisher.as_deref()).ok()
        } else {
            None
        };
        let parsed = key.as_deref().and_then(|k| appkey::parse_app_key(k).ok());
        Some(AppInfo { pid, name, key: key.unwrap_or_default(), parsed, exe: norm.unwrap_or_default(), aumid, integrity })
    }

    /// App dueña de una ventana. Para las de `ApplicationFrameHost.exe` (UWP) la app real es el hijo `CoreWindow`.
    pub fn info_for_window(&mut self, w: &TopWindow) -> Option<AppInfo> {
        let host = self.info_for_pid(w.pid, "")?;
        if !host.exe.ends_with(FRAME_HOST) {
            return Some(host);
        }
        let mut probe = Probe { pid: w.pid, found: None };
        unsafe {
            let _ = EnumChildWindows(Some(w.hwnd), Some(find_core), LPARAM(&mut probe as *mut _ as isize));
        }
        match probe.found {
            Some(real) => self.info_for_pid(real, &w.title),
            None => Some(host),
        }
    }
}

/// Ventanas «de aplicación» (las que ve el usuario en la barra de tareas): visibles, sin dueño, con título y no herramienta.
pub fn is_app_window(w: &TopWindow) -> bool {
    !w.owned && !w.title.is_empty() && !w.tool()
}

/// Ventana raíz que hay bajo un punto: la primera de la lista (orden Z) que lo contiene, saltando las que dejan
/// pasar el ratón (`WS_EX_TRANSPARENT`, p. ej. nuestro overlay). Mira solo ventanas visibles y no minimizadas.
pub fn top_window_at(list: &[TopWindow], x: i32, y: i32) -> Option<&TopWindow> {
    list.iter().find(|w| !w.click_through() && !w.iconic && x >= w.rect.x && y >= w.rect.y && (x as i64) < w.rect.right() && (y as i64) < w.rect.bottom())
}

pub fn foreground_root() -> Option<HWND> {
    unsafe {
        let f = GetForegroundWindow();
        if f.is_invalid() {
            return None;
        }
        let r = GetAncestor(f, GA_ROOT);
        Some(if r.is_invalid() { f } else { r })
    }
}

pub fn describe_hwnd(h: HWND) -> Option<TopWindow> {
    describe(h)
}

pub fn point(x: i32, y: i32) -> POINT {
    POINT { x, y }
}

/// Descripción del archivo (FileDescription), localizada según las traducciones del recurso de versión.
fn file_description(path: &str) -> Option<String> {
    let w = wide(path);
    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(w.as_ptr()), None);
        if size == 0 || size > 4 * 1024 * 1024 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(PCWSTR(w.as_ptr()), None, size, data.as_mut_ptr() as *mut _).ok()?;
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let tr = wide("\\VarFileInfo\\Translation");
        let mut langs: Vec<(u16, u16)> = Vec::new();
        if VerQueryValueW(data.as_ptr() as *const _, PCWSTR(tr.as_ptr()), &mut ptr, &mut len).as_bool() && len >= 4 && !ptr.is_null() {
            let n = (len as usize / 4).min(4);
            let s = std::slice::from_raw_parts(ptr as *const u16, n * 2);
            for i in 0..n {
                langs.push((s[i * 2], s[i * 2 + 1]));
            }
        }
        langs.push((0x0409, 0x04B0));
        for (lang, cp) in langs {
            let q = wide(&format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription"));
            if VerQueryValueW(data.as_ptr() as *const _, PCWSTR(q.as_ptr()), &mut ptr, &mut len).as_bool() && len > 1 && !ptr.is_null() {
                let s = std::slice::from_raw_parts(ptr as *const u16, len as usize);
                let d = from_wide(s);
                if !d.trim().is_empty() {
                    return Some(d.trim().to_string());
                }
            }
        }
        None
    }
}
