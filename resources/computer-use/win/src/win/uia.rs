//! UI Automation: árbol, búsqueda y acciones (lista cerrada) en segundo plano, sin ratón ni teclado reales.
//! Los roles son el ID de ControlType (no dependen del idioma). Nunca se devuelve el valor de un campo de contraseña.

use crate::commands::{AxQuery, NodeView};
use crate::exitcode::{self, CuError, CuResult};
use crate::fuzzy::{fold_text, fuzzy_contains};
use crate::json::{clip, Json};
use crate::limits::VALUE_MAX_CHARS;
use crate::roles::{action_names, normalize_role, role_name, Patterns, UiaAction, CT_WINDOW};
use std::time::{Duration, Instant};
use windows::core::BSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::*;

pub struct Uia {
    a: IUIAutomation,
    cond: IUIAutomationCondition,
    cache: IUIAutomationCacheRequest,
}

/// Datos de un nodo, ya recortados. `value` es None en campos seguros.
#[derive(Debug, Clone)]
pub struct NodeData {
    pub path: String,
    pub control_type: i32,
    pub role: &'static str,
    pub title: Option<String>,
    pub description: Option<String>,
    pub automation_id: Option<String>,
    pub secure: bool,
    pub value: Option<String>,
    pub enabled: bool,
    pub focused: bool,
    pub offscreen: bool,
    pub frame: Option<(f64, f64, f64, f64)>,
    pub patterns: Patterns,
}

impl NodeData {
    pub fn view(&self) -> NodeView<'_> {
        NodeView { role: self.role, title: self.title.as_deref(), description: self.description.as_deref(), value: self.value.as_deref() }
    }

    /// Forma de `ax-tree`/`ax-find` (las mismas claves que el helper de macOS, más `controlType` y `automationId`).
    pub fn to_json(&self) -> Json {
        let mut m = std::collections::BTreeMap::new();
        m.insert("ref".to_string(), Json::str(&self.path));
        m.insert("role".to_string(), Json::str(self.role));
        m.insert("controlType".to_string(), Json::num(self.control_type));
        if let Some(t) = &self.title {
            m.insert("title".into(), Json::str(t));
        }
        if let Some(t) = &self.description {
            m.insert("description".into(), Json::str(t));
        }
        if let Some(t) = &self.automation_id {
            m.insert("automationId".into(), Json::str(t));
        }
        m.insert("secure".into(), Json::Bool(self.secure));
        if let Some(v) = &self.value {
            m.insert("value".into(), Json::str(v));
        }
        m.insert("enabled".into(), Json::Bool(self.enabled));
        m.insert("focused".into(), Json::Bool(self.focused));
        if let Some(f) = self.frame {
            m.insert("frame".into(), frame_json(f));
        }
        m.insert("actions".into(), Json::Arr(action_names(self.patterns).into_iter().map(Json::str).collect()));
        Json::Obj(m)
    }

    /// Forma de `find-elements` (la que consume el MCP): sin `ref`, con `screenPoint` en píxeles físicos.
    pub fn to_find_json(&self) -> Option<Json> {
        let (x, y, w, h) = self.frame?;
        let mut m = std::collections::BTreeMap::new();
        m.insert("role".to_string(), Json::str(self.role));
        if let Some(t) = self.title.as_ref().filter(|t| !t.is_empty()) {
            m.insert("title".into(), Json::str(t));
        }
        if let Some(t) = self.description.as_ref().filter(|t| !t.is_empty()) {
            m.insert("description".into(), Json::str(t));
        }
        if let Some(t) = self.automation_id.as_ref().filter(|t| !t.is_empty()) {
            m.insert("identifier".into(), Json::str(t));
        }
        if let Some(v) = self.value.as_ref().filter(|t| !t.is_empty()) {
            m.insert("value".into(), Json::str(v));
        }
        m.insert("enabled".into(), Json::Bool(self.enabled));
        for (k, v) in [("x", x), ("y", y), ("width", w), ("height", h)] {
            m.insert(k.into(), Json::num(v));
        }
        m.insert("screenPoint".into(), Json::obj([("x", Json::num(x + w / 2.0)), ("y", Json::num(y + h / 2.0))]));
        Some(Json::Obj(m))
    }

    fn haystack(&self) -> String {
        let parts: Vec<&str> = [self.title.as_deref(), self.description.as_deref(), self.automation_id.as_deref(), self.value.as_deref()].into_iter().flatten().collect();
        fold_text(&parts.join(" "))
    }
}

pub fn frame_json((x, y, w, h): (f64, f64, f64, f64)) -> Json {
    Json::obj([("x", Json::num(x)), ("y", Json::num(y)), ("width", Json::num(w)), ("height", Json::num(h))])
}

fn com<T>(r: windows::core::Result<T>, what: &str) -> CuResult<T> {
    r.map_err(|e| CuError::generic(format!("UI Automation ({what}): {e}")))
}

const UIA_E_ELEMENTNOTAVAILABLE: i32 = 0x80040201u32 as i32;

fn changed<T>(r: windows::core::Result<T>, what: &str) -> CuResult<T> {
    r.map_err(|e| {
        if e.code().0 == UIA_E_ELEMENTNOTAVAILABLE {
            CuError::new(exitcode::ELEMENT_CHANGED, format!("El elemento cambió ({what})"))
        } else {
            CuError::new(exitcode::ELEMENT_CHANGED, format!("El elemento cambió ({what}): {e}"))
        }
    })
}

fn variant_bool(v: windows::core::Result<VARIANT>) -> bool {
    v.ok().and_then(|v| bool::try_from(&v).ok()).unwrap_or(false)
}

impl Uia {
    pub fn new() -> CuResult<Uia> {
        unsafe {
            let a: IUIAutomation = com(CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER), "crear")?;
            let cond = com(a.ControlViewCondition(), "vista de control")?;
            let cache = com(a.CreateCacheRequest(), "caché")?;
            for p in [
                UIA_NamePropertyId,
                UIA_ControlTypePropertyId,
                UIA_IsEnabledPropertyId,
                UIA_HasKeyboardFocusPropertyId,
                UIA_IsPasswordPropertyId,
                UIA_IsOffscreenPropertyId,
                UIA_BoundingRectanglePropertyId,
                UIA_HelpTextPropertyId,
                UIA_AutomationIdPropertyId,
                UIA_ValueValuePropertyId,
                UIA_RangeValueValuePropertyId,
                UIA_IsInvokePatternAvailablePropertyId,
                UIA_IsTogglePatternAvailablePropertyId,
                UIA_IsExpandCollapsePatternAvailablePropertyId,
                UIA_IsRangeValuePatternAvailablePropertyId,
                UIA_IsSelectionItemPatternAvailablePropertyId,
                UIA_IsWindowPatternAvailablePropertyId,
                UIA_IsValuePatternAvailablePropertyId,
            ] {
                com(cache.AddProperty(p), "caché")?;
            }
            Ok(Uia { a, cond, cache })
        }
    }

    /// Raíces (con caché) de las ventanas dadas.
    pub fn roots(&self, hwnds: &[HWND]) -> Vec<IUIAutomationElement> {
        hwnds.iter().filter_map(|h| unsafe { self.a.ElementFromHandleBuildCache(*h, &self.cache).ok() }).collect()
    }

    fn children_cached(&self, el: &IUIAutomationElement) -> Vec<IUIAutomationElement> {
        unsafe {
            let Ok(arr) = el.FindAllBuildCache(TreeScope_Children, &self.cond, &self.cache) else { return Vec::new() };
            let n = arr.Length().unwrap_or(0);
            (0..n).filter_map(|i| arr.GetElement(i).ok()).collect()
        }
    }

    fn children(&self, el: &IUIAutomationElement) -> Vec<IUIAutomationElement> {
        unsafe {
            let Ok(arr) = el.FindAll(TreeScope_Children, &self.cond) else { return Vec::new() };
            let n = arr.Length().unwrap_or(0);
            (0..n).filter_map(|i| arr.GetElement(i).ok()).collect()
        }
    }

    /// `path = [ventana, hijo, hijo…]` → elemento FRESCO (sin caché), o None si el árbol cambió.
    pub fn resolve(&self, roots: &[IUIAutomationElement], path: &[usize]) -> Option<IUIAutomationElement> {
        let mut cur = roots.get(*path.first()?)?.clone();
        for &i in &path[1..] {
            cur = self.children(&cur).into_iter().nth(i)?;
        }
        Some(cur)
    }

    fn read(&self, el: &IUIAutomationElement, path: String) -> NodeData {
        unsafe {
            let ct = el.CachedControlType().map(|c| c.0).unwrap_or(0);
            let s = |r: windows::core::Result<BSTR>| r.map(|b| b.to_string()).ok().filter(|s| !s.is_empty()).map(|s| clip(&s, VALUE_MAX_CHARS));
            // Si no se puede saber si es contraseña, se oculta el valor (falla cerrado).
            let secure = el.CachedIsPassword().map(|b| b.as_bool()).unwrap_or(true);
            let value = if secure {
                None
            } else {
                match el.GetCachedPropertyValue(UIA_ValueValuePropertyId).ok().and_then(|v| BSTR::try_from(&v).ok()) {
                    Some(b) => Some(clip(&b.to_string(), VALUE_MAX_CHARS)).filter(|s| !s.is_empty()),
                    None => el
                        .GetCachedPropertyValue(UIA_RangeValueValuePropertyId)
                        .ok()
                        .and_then(|v| f64::try_from(&v).ok())
                        .map(|n| Json::num(n).to_line()),
                }
            };
            let frame = el.CachedBoundingRectangle().ok().map(|r| (r.left as f64, r.top as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64));
            let avail = |p: UIA_PROPERTY_ID| variant_bool(el.GetCachedPropertyValue(p));
            NodeData {
                path,
                control_type: ct,
                role: role_name(ct),
                title: s(el.CachedName()),
                description: s(el.CachedHelpText()),
                automation_id: s(el.CachedAutomationId()),
                secure,
                value,
                enabled: el.CachedIsEnabled().map(|b| b.as_bool()).unwrap_or(true),
                focused: el.CachedHasKeyboardFocus().map(|b| b.as_bool()).unwrap_or(false),
                offscreen: variant_bool(el.GetCachedPropertyValue(UIA_IsOffscreenPropertyId)),
                frame,
                patterns: Patterns {
                    invoke: avail(UIA_IsInvokePatternAvailablePropertyId),
                    toggle: avail(UIA_IsTogglePatternAvailablePropertyId),
                    expand_collapse: avail(UIA_IsExpandCollapsePatternAvailablePropertyId),
                    range_value: avail(UIA_IsRangeValuePatternAvailablePropertyId),
                    selection_item: avail(UIA_IsSelectionItemPatternAvailablePropertyId),
                    window: avail(UIA_IsWindowPatternAvailablePropertyId),
                    value: avail(UIA_IsValuePatternAvailablePropertyId),
                },
            }
        }
    }

    /// Recorre en profundidad (preorden) acotado por profundidad, nodos y TIEMPO. `visit` devuelve false para parar.
    /// Devuelve `truncated`.
    pub fn walk(&self, roots: &[IUIAutomationElement], max_depth: usize, max_nodes: usize, budget: Duration, visit: &mut dyn FnMut(NodeData) -> bool) -> bool {
        struct St<'a> {
            u: &'a Uia,
            max_depth: usize,
            max_nodes: usize,
            deadline: Instant,
            visited: usize,
            truncated: bool,
            stop: bool,
        }
        fn go(st: &mut St, el: &IUIAutomationElement, path: String, depth: usize, visit: &mut dyn FnMut(NodeData) -> bool) {
            if st.stop {
                return;
            }
            if st.visited >= st.max_nodes || Instant::now() >= st.deadline {
                st.truncated = true;
                st.stop = true;
                return;
            }
            st.visited += 1;
            if !visit(st.u.read(el, path.clone())) {
                st.stop = true;
                return;
            }
            let kids = st.u.children_cached(el);
            if depth >= st.max_depth {
                if !kids.is_empty() {
                    st.truncated = true;
                }
                return;
            }
            for (i, k) in kids.iter().enumerate() {
                go(st, k, format!("{path}.{i}"), depth + 1, visit);
                if st.stop {
                    return;
                }
            }
        }
        let mut st = St { u: self, max_depth, max_nodes, deadline: Instant::now() + budget, visited: 0, truncated: false, stop: false };
        for (i, r) in roots.iter().enumerate() {
            go(&mut st, r, format!("w{i}"), 0, visit);
            if st.stop {
                break;
            }
        }
        st.truncated
    }

    pub fn tree(&self, roots: &[IUIAutomationElement], max_depth: usize, max_nodes: usize, budget: Duration) -> (Vec<Json>, bool) {
        let mut nodes = Vec::new();
        let t = self.walk(roots, max_depth, max_nodes, budget, &mut |n| {
            nodes.push(n.to_json());
            true
        });
        (nodes, t)
    }

    pub fn find(&self, roots: &[IUIAutomationElement], q: &AxQuery, max_depth: usize, max_nodes: usize, budget: Duration) -> Vec<Json> {
        let mut out = Vec::new();
        self.walk(roots, max_depth, max_nodes, budget, &mut |n| {
            if q.matches(&n.view()) {
                out.push(n.to_json());
            }
            out.len() < q.limit
        });
        out
    }

    /// `find-elements`: elementos visibles con tamaño, por rol (ControlType) y texto difuso. Devuelve (resultados, truncado).
    pub fn find_elements(&self, roots: &[IUIAutomationElement], roles: &Option<Vec<String>>, query: &Option<String>, max_nodes: usize, max_matches: usize, budget: Duration) -> (Vec<Json>, bool) {
        let mut out = Vec::new();
        let want: Option<Vec<String>> = roles.as_ref().map(|v| v.iter().map(|r| r.to_lowercase()).collect());
        let truncated = self.walk(roots, 60, max_nodes, budget, &mut |n| {
            let role_ok = want.as_ref().is_none_or(|w| w.contains(&n.role.to_lowercase()));
            let sized = n.frame.is_some_and(|(_, _, w, h)| w > 0.0 && h > 0.0) && !n.offscreen;
            if role_ok && sized {
                let text_ok = match query {
                    Some(q) if !q.is_empty() => fuzzy_contains(&n.haystack(), q),
                    _ => true,
                };
                if text_ok {
                    if let Some(j) = n.to_find_json() {
                        out.push(j);
                    }
                }
            }
            out.len() < max_matches
        });
        (out, truncated)
    }

    /// ¿El elemento con el foco es un campo de contraseña? Falla cerrado: si no se puede saber, sí.
    pub fn focused_is_secure(&self) -> bool {
        unsafe {
            match self.a.GetFocusedElement() {
                Ok(el) => el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(true),
                Err(_) => true,
            }
        }
    }

    pub fn frame_of(&self, el: &IUIAutomationElement) -> CuResult<(f64, f64, f64, f64)> {
        let r = changed(unsafe { el.CurrentBoundingRectangle() }, "sin marco")?;
        if r.right <= r.left || r.bottom <= r.top {
            return Err(CuError::new(exitcode::ELEMENT_CHANGED, "Sin marco para el elemento"));
        }
        Ok((r.left as f64, r.top as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64))
    }

    /// Comprueba rol y título esperados (como el helper de macOS) para detectar que el árbol cambió.
    pub fn expect(&self, el: &IUIAutomationElement, role: &Option<String>, title: &Option<String>) -> CuResult<()> {
        unsafe {
            if let Some(r) = role {
                let ct = changed(el.CurrentControlType(), "rol")?;
                let want = normalize_role(r).map(|s| s.to_lowercase()).unwrap_or_else(|| r.trim().to_lowercase());
                if role_name(ct.0).to_lowercase() != want {
                    return Err(CuError::new(exitcode::ELEMENT_CHANGED, "El elemento cambió (rol distinto)"));
                }
            }
            if let Some(t) = title {
                let name = changed(el.CurrentName(), "título")?.to_string();
                if name != *t {
                    return Err(CuError::new(exitcode::ELEMENT_CHANGED, "El elemento cambió (título distinto)"));
                }
            }
        }
        Ok(())
    }

    pub fn press(&self, el: &IUIAutomationElement) -> CuResult<()> {
        unsafe {
            if !changed(el.CurrentIsEnabled(), "estado")?.as_bool() {
                return Err(CuError::new(exitcode::ELEMENT_CHANGED, "El elemento está deshabilitado"));
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
                return changed(p.Invoke(), "no se pudo pulsar");
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) {
                return changed(p.Toggle(), "no se pudo pulsar");
            }
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId) {
                return changed(p.Select(), "no se pudo pulsar");
            }
        }
        Err(CuError::new(exitcode::ELEMENT_CHANGED, "El elemento cambió (no se pudo pulsar)"))
    }

    pub fn set_value(&self, el: &IUIAutomationElement, value: &str) -> CuResult<()> {
        unsafe {
            if changed(el.CurrentIsPassword(), "campo seguro")?.as_bool() {
                return Err(CuError::new(exitcode::SECURE_FIELD, "Campo seguro: no se puede escribir por UI Automation"));
            }
            let p = el
                .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .map_err(|_| CuError::new(exitcode::NOT_EDITABLE, "El valor no se puede editar"))?;
            if p.CurrentIsReadOnly().map(|b| b.as_bool()).unwrap_or(true) {
                return Err(CuError::new(exitcode::NOT_EDITABLE, "El valor no se puede editar"));
            }
            p.SetValue(&BSTR::from(value)).map_err(|_| CuError::new(exitcode::NOT_EDITABLE, "No se pudo escribir el valor"))
        }
    }

    /// Acción de la lista cerrada traducida a patrones de UIA (`UiaAction::pattern`).
    pub fn action(&self, el: &IUIAutomationElement, action: UiaAction) -> CuResult<()> {
        let fail = |what: &str| CuError::new(exitcode::ELEMENT_CHANGED, format!("El elemento cambió ({what})"));
        unsafe {
            match action {
                UiaAction::ShowMenu => {
                    let p = el.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).map_err(|_| fail("sin ExpandCollapse"))?;
                    changed(p.Expand(), "no se pudo realizar la acción")
                }
                UiaAction::Cancel => {
                    let p = el.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).map_err(|_| fail("sin ExpandCollapse"))?;
                    changed(p.Collapse(), "no se pudo realizar la acción")
                }
                UiaAction::Increment | UiaAction::Decrement => {
                    let p = el.GetCurrentPatternAs::<IUIAutomationRangeValuePattern>(UIA_RangeValuePatternId).map_err(|_| fail("sin RangeValue"))?;
                    if p.CurrentIsReadOnly().map(|b| b.as_bool()).unwrap_or(true) {
                        return Err(fail("valor de solo lectura"));
                    }
                    let (cur, min, max) = (changed(p.CurrentValue(), "valor")?, p.CurrentMinimum().unwrap_or(f64::MIN), p.CurrentMaximum().unwrap_or(f64::MAX));
                    let mut step = p.CurrentSmallChange().unwrap_or(0.0);
                    if step <= 0.0 {
                        step = p.CurrentLargeChange().unwrap_or(0.0);
                    }
                    if step <= 0.0 {
                        step = ((max - min) / 10.0).max(1.0);
                    }
                    let next = if action == UiaAction::Increment { cur + step } else { cur - step };
                    changed(p.SetValue(next.clamp(min, max)), "no se pudo realizar la acción")
                }
                UiaAction::Confirm => {
                    let p = el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).map_err(|_| fail("sin Invoke"))?;
                    changed(p.Invoke(), "no se pudo realizar la acción")
                }
                UiaAction::Pick => {
                    let p = el.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId).map_err(|_| fail("sin SelectionItem"))?;
                    changed(p.Select(), "no se pudo realizar la acción")
                }
                UiaAction::Raise => {
                    if changed(el.CurrentControlType(), "rol")?.0 == CT_WINDOW {
                        if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationWindowPattern>(UIA_WindowPatternId) {
                            if p.CurrentWindowVisualState().map(|s| s == WindowVisualState_Minimized).unwrap_or(false) {
                                let _ = p.SetWindowVisualState(WindowVisualState_Normal);
                            }
                        }
                    }
                    changed(el.SetFocus(), "no se pudo realizar la acción")
                }
            }
        }
    }
}
