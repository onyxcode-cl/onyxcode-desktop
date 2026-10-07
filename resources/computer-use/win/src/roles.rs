//! Roles (ControlType de UI Automation) y acciones: listas CERRADAS y puras.
//! Los roles se asignan por el ID de ControlType (independiente del idioma), nunca por texto.

/// (id de ControlType, nombre del rol que se imprime).
pub const CONTROL_TYPES: [(i32, &str); 41] = [
    (50000, "Button"),
    (50001, "Calendar"),
    (50002, "CheckBox"),
    (50003, "ComboBox"),
    (50004, "Edit"),
    (50005, "Hyperlink"),
    (50006, "Image"),
    (50007, "ListItem"),
    (50008, "List"),
    (50009, "Menu"),
    (50010, "MenuBar"),
    (50011, "MenuItem"),
    (50012, "ProgressBar"),
    (50013, "RadioButton"),
    (50014, "ScrollBar"),
    (50015, "Slider"),
    (50016, "Spinner"),
    (50017, "StatusBar"),
    (50018, "Tab"),
    (50019, "TabItem"),
    (50020, "Text"),
    (50021, "ToolBar"),
    (50022, "ToolTip"),
    (50023, "Tree"),
    (50024, "TreeItem"),
    (50025, "Custom"),
    (50026, "Group"),
    (50027, "Thumb"),
    (50028, "DataGrid"),
    (50029, "DataItem"),
    (50030, "Document"),
    (50031, "SplitButton"),
    (50032, "Window"),
    (50033, "Pane"),
    (50034, "Header"),
    (50035, "HeaderItem"),
    (50036, "Table"),
    (50037, "TitleBar"),
    (50038, "Separator"),
    (50039, "SemanticZoom"),
    (50040, "AppBar"),
];

pub const CT_EDIT: i32 = 50004;
pub const CT_WINDOW: i32 = 50032;

pub fn role_name(control_type: i32) -> &'static str {
    CONTROL_TYPES.iter().find(|(id, _)| *id == control_type).map(|(_, n)| *n).unwrap_or("Unknown")
}

/// Alias en lenguaje llano → nombre de rol (los mismos del helper de macOS, traducidos a ControlType).
const ALIASES: &[(&str, &str)] = &[
    ("button", "Button"),
    ("textfield", "Edit"),
    ("textinput", "Edit"),
    ("searchfield", "Edit"),
    ("securetextfield", "Edit"),
    ("textarea", "Edit"),
    ("edit", "Edit"),
    ("checkbox", "CheckBox"),
    ("switch", "CheckBox"),
    ("radiobutton", "RadioButton"),
    ("radio", "RadioButton"),
    ("menu", "Menu"),
    ("menuitem", "MenuItem"),
    ("menubutton", "SplitButton"),
    ("menubar", "MenuBar"),
    ("link", "Hyperlink"),
    ("statictext", "Text"),
    ("text", "Text"),
    ("label", "Text"),
    ("image", "Image"),
    ("slider", "Slider"),
    ("combobox", "ComboBox"),
    ("popupbutton", "ComboBox"),
    ("popup", "ComboBox"),
    ("table", "Table"),
    ("outline", "Tree"),
    ("row", "DataItem"),
    ("cell", "DataItem"),
    ("list", "List"),
    ("window", "Window"),
    ("sheet", "Window"),
    ("toolbar", "ToolBar"),
    ("group", "Group"),
    ("scrollarea", "Pane"),
    ("scrollbar", "ScrollBar"),
    ("tabgroup", "Tab"),
    ("disclosuretriangle", "Button"),
    ("progressindicator", "ProgressBar"),
    ("stepper", "Spinner"),
    ("incrementor", "Spinner"),
];

/// Normaliza el rol pedido (`button`, `AXButton`, `Edit`…) al nombre de ControlType; None si no se conoce.
pub fn normalize_role(raw: &str) -> Option<&'static str> {
    let t = raw.trim();
    let t = t.strip_prefix("AX").unwrap_or(t);
    let key: String = t.chars().filter(|c| !matches!(c, '_' | '-' | ' ')).collect::<String>().to_lowercase();
    if key.is_empty() {
        return None;
    }
    if let Some((_, n)) = ALIASES.iter().find(|(a, _)| *a == key) {
        return Some(n);
    }
    CONTROL_TYPES.iter().map(|(_, n)| *n).find(|n| n.to_lowercase() == key)
}

/// Acciones de la lista CERRADA de `ax-action` (nombres del contrato, comunes con macOS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiaAction {
    ShowMenu,
    Increment,
    Decrement,
    Confirm,
    Cancel,
    Raise,
    Pick,
}

pub const ACTION_NAMES: [&str; 7] = ["AXShowMenu", "AXIncrement", "AXDecrement", "AXConfirm", "AXCancel", "AXRaise", "AXPick"];

impl UiaAction {
    pub fn parse(s: &str) -> Option<UiaAction> {
        Some(match s {
            "AXShowMenu" => UiaAction::ShowMenu,
            "AXIncrement" => UiaAction::Increment,
            "AXDecrement" => UiaAction::Decrement,
            "AXConfirm" => UiaAction::Confirm,
            "AXCancel" => UiaAction::Cancel,
            "AXRaise" => UiaAction::Raise,
            "AXPick" => UiaAction::Pick,
            _ => return None,
        })
    }
    /// Patrón de UI Automation que la implementa (documentación y pruebas).
    pub fn pattern(self) -> &'static str {
        match self {
            UiaAction::ShowMenu => "ExpandCollapse",
            UiaAction::Increment | UiaAction::Decrement => "RangeValue",
            UiaAction::Confirm => "Invoke",
            UiaAction::Cancel => "ExpandCollapse",
            UiaAction::Raise => "Window",
            UiaAction::Pick => "SelectionItem",
        }
    }
}

/// Disponibilidad de patrones de un elemento → lista de acciones (nombres AX) que se publican en `actions`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Patterns {
    pub invoke: bool,
    pub toggle: bool,
    pub expand_collapse: bool,
    pub range_value: bool,
    pub selection_item: bool,
    pub window: bool,
    pub value: bool,
}

pub fn action_names(p: Patterns) -> Vec<&'static str> {
    let mut v = Vec::new();
    if p.invoke || p.toggle {
        v.push("AXPress");
    }
    if p.expand_collapse {
        v.push("AXShowMenu");
        v.push("AXCancel");
    }
    if p.range_value {
        v.push("AXIncrement");
        v.push("AXDecrement");
    }
    if p.selection_item {
        v.push("AXPick");
    }
    if p.window {
        v.push("AXRaise");
    }
    v
}

/// Referencia de elemento: `w<ventana>.<hijo>.<hijo>…` (índices de la vista de control, ≤ 40 niveles).
pub fn parse_ref(r: &str) -> Result<Vec<usize>, String> {
    let bad = || Err(format!("Referencia no válida: «{}»", r.chars().take(40).collect::<String>()));
    let mut parts = r.split('.');
    let Some(first) = parts.next() else { return bad() };
    let Some(w) = first.strip_prefix('w') else { return bad() };
    let num = |s: &str| -> Option<usize> {
        if s.is_empty() || s.len() > 6 || !s.bytes().all(|b| b.is_ascii_digit()) {
            None
        } else {
            s.parse().ok()
        }
    };
    let Some(win) = num(w) else { return bad() };
    let mut out = vec![win];
    for p in parts {
        match num(p) {
            Some(i) => out.push(i),
            None => return bad(),
        }
    }
    if out.len() > 41 {
        return bad();
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_unicos_y_consecutivos() {
        for (i, (id, name)) in CONTROL_TYPES.iter().enumerate() {
            assert_eq!(*id, 50000 + i as i32, "{name}");
        }
        assert_eq!(role_name(50000), "Button");
        assert_eq!(role_name(50004), "Edit");
        assert_eq!(role_name(50032), "Window");
        assert_eq!(role_name(1), "Unknown");
        assert_eq!(CONTROL_TYPES[(CT_EDIT - 50000) as usize].1, "Edit");
        assert_eq!(CONTROL_TYPES[(CT_WINDOW - 50000) as usize].1, "Window");
    }

    #[test]
    fn roles_normalizados() {
        assert_eq!(normalize_role("button"), Some("Button"));
        assert_eq!(normalize_role("AXButton"), Some("Button"));
        assert_eq!(normalize_role("text_field"), Some("Edit"));
        assert_eq!(normalize_role("Text-Field"), Some("Edit"));
        assert_eq!(normalize_role("Hyperlink"), Some("Hyperlink"));
        assert_eq!(normalize_role("AXSecureTextField"), Some("Edit"));
        assert_eq!(normalize_role("DataGrid"), Some("DataGrid"));
        assert_eq!(normalize_role(""), None);
        assert_eq!(normalize_role("nopeRole"), None);
        for (_, n) in ALIASES {
            assert!(CONTROL_TYPES.iter().any(|(_, c)| c == n), "alias a rol inexistente: {n}");
        }
    }

    #[test]
    fn lista_cerrada_de_acciones() {
        for n in ACTION_NAMES {
            assert!(UiaAction::parse(n).is_some(), "{n}");
        }
        for bad in ["AXPress", "AXDelete", "axshowmenu", "", "AXShowMenu ", "Invoke", "AXRaise;rm"] {
            assert!(UiaAction::parse(bad).is_none(), "{bad:?}");
        }
        assert_eq!(UiaAction::parse("AXRaise").unwrap().pattern(), "Window");
        assert_eq!(UiaAction::parse("AXPick").unwrap().pattern(), "SelectionItem");
    }

    #[test]
    fn acciones_por_patron() {
        assert!(action_names(Patterns::default()).is_empty());
        let p = Patterns { invoke: true, range_value: true, window: true, ..Default::default() };
        assert_eq!(action_names(p), vec!["AXPress", "AXIncrement", "AXDecrement", "AXRaise"]);
    }

    #[test]
    fn referencias() {
        assert_eq!(parse_ref("w0"), Ok(vec![0]));
        assert_eq!(parse_ref("w2.0.14.3"), Ok(vec![2, 0, 14, 3]));
        for bad in ["", "m.0", "w", "w.1", "w0.", "w0..1", "wx", "w-1", "w0.1a", "w1234567", "0.1", "W0", "w0 .1", "w0.+1"] {
            assert!(parse_ref(bad).is_err(), "{bad:?}");
        }
        let long = format!("w0{}", ".1".repeat(41));
        assert!(parse_ref(&long).is_err());
        let ok = format!("w0{}", ".1".repeat(40));
        assert!(parse_ref(&ok).is_ok());
    }
}
