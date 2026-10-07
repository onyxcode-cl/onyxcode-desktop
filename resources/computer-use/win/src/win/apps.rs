//! Apps: identidad por clave, ventanas de cada app, activar, minimizar y restaurar. NO lanza procesos
//! (`open-app`, `open-app-bg` y `resolve-app` quedan diferidos: abrir programas por nombre exige AppsFolder y decidir
//! qué es «instalado»).

use super::process::Integrity;
use super::util::sleep_ms;
use super::wnd::{self, AppCache, AppInfo, TopWindow};
use crate::appkey::AppKey;
use crate::exitcode::{self, CuError, CuResult};
use crate::fuzzy::fold_text;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOWMINNOACTIVE, SW_SHOWNOACTIVATE,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

pub const BLOCKED_MSG: &str =
    "La ventana pertenece a un programa con permisos de administrador o bloqueado; Lazunox no puede ni debe controlarla. Hazlo tú.";

pub struct AppTarget {
    pub info: AppInfo,
    pub windows: Vec<TopWindow>,
}

/// Clases de ventana del shell que NUNCA se minimizan ni se tratan como ventanas de app.
const SHELL_CLASSES: [&str; 6] = ["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "Windows.UI.Core.CoreWindow", "NotifyIconOverflowWindow"];

pub fn is_shell_window(w: &TopWindow) -> bool {
    SHELL_CLASSES.iter().any(|c| *c == w.class)
}

/// Ventanas visibles (minimizadas incluidas) de la app con esa clave. Err 7 si no hay ninguna; Err 11 si está bloqueada.
pub fn resolve(cache: &mut AppCache, key: &AppKey) -> CuResult<AppTarget> {
    let want = key.to_key_string();
    let all = wnd::enum_top(true).map_err(CuError::unavailable)?;
    let mut mine: Vec<TopWindow> = Vec::new();
    let mut info: Option<AppInfo> = None;
    for w in all {
        if is_shell_window(&w) || (w.tool() && w.title.is_empty()) {
            continue;
        }
        if let Some(i) = cache.info_for_window(&w) {
            if i.key == want {
                info.get_or_insert(i);
                mine.push(w);
            }
        }
    }
    let Some(info) = info else {
        // Puede ser un programa bloqueado cuyo identificador no se puede construir: se distingue por la lista.
        if crate::blocklist::key_blocked(key) {
            return Err(CuError::not_allowed(BLOCKED_MSG));
        }
        return Err(CuError::new(exitcode::APP_NOT_RUNNING, "La app no está en ejecución (sin ventanas visibles)"));
    };
    if info.blocked() {
        return Err(CuError::not_allowed(BLOCKED_MSG));
    }
    mine.sort_by_key(|w| w.hwnd.0 as usize);
    Ok(AppTarget { info, windows: mine })
}

/// App dueña de la ventana raíz que hay en primer plano.
pub fn frontmost(cache: &mut AppCache) -> Option<AppInfo> {
    let h = wnd::foreground_root()?;
    let w = wnd::describe_hwnd(h)?;
    cache.info_for_window(&w)
}

/// Rechaza (11) si la ventana en primer plano es de una app bloqueada o elevada, o no se puede identificar.
pub fn require_foreground_controllable(cache: &mut AppCache) -> CuResult<()> {
    match wnd::foreground_root() {
        None => Ok(()),
        Some(h) => {
            let blocked = match wnd::describe_hwnd(h) {
                None => true,
                Some(w) => cache.info_for_window(&w).is_none_or(|i| i.blocked()),
            };
            if blocked {
                Err(CuError::not_allowed(BLOCKED_MSG))
            } else {
                Ok(())
            }
        }
    }
}

/// Rechaza (11) si lo que hay bajo el punto (saltando ventanas que dejan pasar el ratón) es bloqueado o elevado.
pub fn require_point_controllable(cache: &mut AppCache, x: i32, y: i32) -> CuResult<()> {
    let list = wnd::enum_top(false).map_err(CuError::unavailable)?;
    match wnd::top_window_at(&list, x, y) {
        None => Ok(()),
        Some(w) => {
            if cache.info_for_window(w).is_none_or(|i| i.blocked()) {
                Err(CuError::not_allowed(BLOCKED_MSG))
            } else {
                Ok(())
            }
        }
    }
}

/// Apps con ventana visible (una por clave), de delante hacia atrás.
pub fn list(cache: &mut AppCache) -> CuResult<Vec<AppInfo>> {
    let all = wnd::enum_top(false).map_err(CuError::unavailable)?;
    let mut out: Vec<AppInfo> = Vec::new();
    for w in all {
        if is_shell_window(&w) || !wnd::is_app_window(&w) {
            continue;
        }
        if let Some(i) = cache.info_for_window(&w) {
            if !i.key.is_empty() && !out.iter().any(|o| o.key == i.key) {
                out.push(i);
            }
        }
    }
    Ok(out)
}

fn matches_target(i: &AppInfo, target: &str) -> bool {
    if i.key == target {
        return true;
    }
    let t = fold_text(target.trim());
    if t.is_empty() {
        return false;
    }
    let base = crate::appkey::exe_base_name(&i.exe);
    fold_text(&i.name) == t || fold_text(&i.name).contains(&t) || fold_text(base) == t || fold_text(base.strip_suffix(".exe").unwrap_or(base)) == t
}

fn bring_to_front(h: HWND) {
    unsafe {
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        let fg = wnd::foreground_root().unwrap_or_default();
        let (tid_fg, tid_me) = (GetWindowThreadProcessId(fg, None), GetCurrentThreadId());
        let attached = tid_fg != 0 && tid_fg != tid_me && AttachThreadInput(tid_me, tid_fg, true).as_bool();
        let _ = BringWindowToTop(h);
        let _ = SetForegroundWindow(h);
        if attached {
            let _ = AttachThreadInput(tid_me, tid_fg, false);
        }
    }
}

/// `activate`: trae la app al frente (restaura si estaba minimizada). Devuelve (activated, hasWindow).
pub fn activate(cache: &mut AppCache, target: &str) -> CuResult<(bool, bool)> {
    let all = wnd::enum_top(true).map_err(CuError::unavailable)?;
    let mut cands: Vec<(TopWindow, AppInfo)> = Vec::new();
    for w in all {
        if is_shell_window(&w) || !wnd::is_app_window(&w) {
            continue;
        }
        if let Some(i) = cache.info_for_window(&w) {
            if matches_target(&i, target) {
                cands.push((w, i));
            }
        }
    }
    // Prefiere una ventana que no esté minimizada (la más cercana al frente).
    cands.sort_by_key(|(w, _)| w.iconic);
    let Some((w, info)) = cands.into_iter().next() else { return Ok((false, false)) };
    if info.blocked() {
        return Err(CuError::not_allowed(BLOCKED_MSG));
    }
    bring_to_front(w.hwnd);
    for _ in 0..12 {
        sleep_ms(50.0);
        if wnd::foreground_root() == Some(w.hwnd) {
            return Ok((true, true));
        }
    }
    Ok((false, true))
}

/// `hide-apps`: minimiza (sin activar) las ventanas de las apps que NO están en `keep`. Nunca el shell, nunca ventanas
/// elevadas o bloqueadas (no se pueden ni se deben tocar). Devuelve las claves minimizadas.
pub fn hide(cache: &mut AppCache, keep: &[AppKey]) -> CuResult<Vec<String>> {
    let keep: Vec<String> = keep.iter().map(|k| k.to_key_string()).collect();
    let all = wnd::enum_top(false).map_err(CuError::unavailable)?;
    let own = std::process::id();
    let mut hidden: Vec<String> = Vec::new();
    for w in all {
        if is_shell_window(&w) || !wnd::is_app_window(&w) || w.pid == own {
            continue;
        }
        let Some(i) = cache.info_for_window(&w) else { continue };
        if i.key.is_empty() || keep.contains(&i.key) || i.blocked() || i.integrity == Integrity::Unknown {
            continue;
        }
        unsafe {
            let _ = ShowWindow(w.hwnd, SW_SHOWMINNOACTIVE);
        }
        if !hidden.contains(&i.key) {
            hidden.push(i.key);
        }
    }
    Ok(hidden)
}

/// `unhide-apps`: restaura (sin activar) las ventanas minimizadas de las apps de la lista. Devuelve las claves restauradas.
pub fn unhide(cache: &mut AppCache, list: &[AppKey]) -> CuResult<Vec<String>> {
    let want: Vec<String> = list.iter().map(|k| k.to_key_string()).collect();
    let all = wnd::enum_top(true).map_err(CuError::unavailable)?;
    let mut shown: Vec<String> = Vec::new();
    for w in all {
        if !w.iconic || is_shell_window(&w) || !wnd::is_app_window(&w) {
            continue;
        }
        let Some(i) = cache.info_for_window(&w) else { continue };
        if want.contains(&i.key) && !i.blocked() {
            unsafe {
                let _ = ShowWindow(w.hwnd, SW_SHOWNOACTIVATE);
            }
            if !shown.contains(&i.key) {
                shown.push(i.key);
            }
        }
    }
    Ok(shown)
}

/// Rectángulos de las ventanas visibles (no minimizadas) de las apps dadas.
pub fn windows_of(cache: &mut AppCache, keys: &[AppKey]) -> CuResult<Vec<crate::mask::Rect>> {
    let want: Vec<String> = keys.iter().map(|k| k.to_key_string()).collect();
    let all = wnd::enum_top(false).map_err(CuError::unavailable)?;
    Ok(all
        .into_iter()
        .filter(|w| !is_shell_window(w) && !(w.tool() && w.title.is_empty()))
        .filter(|w| cache.info_for_window(w).is_some_and(|i| want.contains(&i.key)))
        .map(|w| w.frame)
        .collect())
}

/// Identidad de un PID en forma de objeto del contrato (`name`, `bundleId`=clave, `pid`).
pub fn info_json(i: &AppInfo) -> crate::json::Json {
    use crate::json::Json;
    Json::obj([("name", Json::str(&i.name)), ("bundleId", Json::str(&i.key)), ("pid", Json::num(i.pid))])
}
