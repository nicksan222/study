//! Scans the desktop app's `ui/` and `study-ui` for string literals a user could see, so
//! every visible word comes from this crate. Element ids, developer-only macros, `expect`
//! messages, test modules and a short allow-list are not copy.

use proc_macro2::{TokenStream, TokenTree};
use std::{
    fs,
    path::{Path, PathBuf},
};
use syn::{LitStr, visit::Visit};

/// The string literals of a file, and the names of its out-of-line test-only modules
/// (`#[cfg(test)] mod tests;`), whose files are fixtures rather than UI.
#[derive(Default)]
struct StringLiterals {
    literals: Vec<String>,
    test_modules: Vec<String>,
}

impl StringLiterals {
    fn visit_tokens(&mut self, tokens: TokenStream) {
        for token in tokens {
            match token {
                TokenTree::Group(group) => self.visit_tokens(group.stream()),
                TokenTree::Literal(literal) => {
                    if let Ok(value) = syn::parse_str::<LitStr>(&literal.to_string()) {
                        self.literals.push(value.value());
                    }
                }
                _ => {}
            }
        }
    }
}

fn literals_in(source: &str) -> Vec<String> {
    literals_in_file(source, Path::new("<inline>")).literals
}

/// The string literals in a Rust source, naming `path` if it does not parse.
fn literals_in_file(source: &str, path: &Path) -> StringLiterals {
    let syntax =
        syn::parse_file(source).unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
    let mut literals = StringLiterals::default();
    literals.visit_file(&syntax);
    literals
}

impl<'ast> Visit<'ast> for StringLiterals {
    fn visit_item_mod(&mut self, module: &'ast syn::ItemMod) {
        let test_only = module.attrs.iter().any(|attribute| {
            attribute.path().is_ident("cfg")
                && attribute
                    .meta
                    .require_list()
                    .is_ok_and(|list| list.tokens.to_string() == "test")
        });
        if !test_only {
            syn::visit::visit_item_mod(self, module);
        } else if module.content.is_none() {
            self.test_modules.push(module.ident.to_string());
        }
    }

    /// `const NAME: &str = "kebab-name"` names element ids, as the `ids` modules do: not copy.
    fn visit_item_const(&mut self, item: &'ast syn::ItemConst) {
        if let syn::Expr::Lit(value) = &*item.expr
            && let syn::Lit::Str(name) = &value.lit
            && is_element_name(&name.value())
        {
            return;
        }
        syn::visit::visit_item_const(self, item);
    }

    /// `("kebab-name", number)` is a GPUI element id, not copy: its name is skipped.
    fn visit_expr_tuple(&mut self, tuple: &'ast syn::ExprTuple) {
        let mut elements = tuple.elems.iter();
        if let (Some(syn::Expr::Lit(first)), 2) = (elements.next(), tuple.elems.len())
            && let syn::Lit::Str(name) = &first.lit
            && is_element_name(&name.value())
        {
            elements.for_each(|element| self.visit_expr(element));
            return;
        }
        syn::visit::visit_expr_tuple(self, tuple);
    }

    /// The message of `.expect(..)` is an invariant only developers read: not copy.
    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        if call.method == "expect" {
            self.visit_expr(&call.receiver);
            return;
        }
        syn::visit::visit_expr_method_call(self, call);
    }

    fn visit_lit_str(&mut self, literal: &'ast LitStr) {
        self.literals.push(literal.value());
    }

    fn visit_attribute(&mut self, _: &'ast syn::Attribute) {
        // Documentation and compiler metadata are not UI copy.
    }

    fn visit_macro(&mut self, macro_call: &'ast syn::Macro) {
        let name = macro_call
            .path
            .segments
            .last()
            .map(|segment| segment.ident.to_string())
            .unwrap_or_default();
        if !DEVELOPER_MACROS.contains(&name.as_str()) {
            self.visit_tokens(macro_call.tokens.clone());
        }
    }
}

/// Macros whose strings only developers read: embedded files, build conditions, invariant
/// or unreachable-code messages, and logs. Their literals are never UI copy.
const DEVELOPER_MACROS: &[&str] = &[
    "include_bytes",
    "include_str",
    "cfg",
    "assert",
    "assert_eq",
    "assert_ne",
    "debug_assert",
    "debug_assert_eq",
    "debug_assert_ne",
    "unreachable",
    "panic",
    "todo",
    "unimplemented",
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "event",
];

#[test]
fn developer_macros_are_not_copy() {
    let source = r#"fn render() {
        let _ = cfg!(target_os = "macos");
        debug_assert!(ok, "zoom outside the range");
        tracing::warn!(%error, "cannot load the page");
        let _ = format!("Visible {x}");
    }"#;
    assert_eq!(literals_in(source), ["Visible {x}"]);
}

/// Lowercase words joined by dashes, as element ids are named.
fn is_element_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .split('-')
            .all(|word| !word.is_empty() && word.bytes().all(|byte| byte.is_ascii_lowercase()))
}

/// Where the out-of-line modules `names`, declared in `file`, live: `name.rs` and `name/`
/// next to a `mod.rs`, or inside the directory named after any other file.
fn test_module_paths(file: &Path, names: &[String]) -> Vec<PathBuf> {
    let parent = file.parent().expect("a source file sits in a directory");
    let directory = match file.file_stem().and_then(|stem| stem.to_str()) {
        Some("mod" | "lib" | "main") => parent.to_owned(),
        Some(stem) => parent.join(stem),
        None => parent.to_owned(),
    };
    names
        .iter()
        .flat_map(|name| [directory.join(format!("{name}.rs")), directory.join(name)])
        .collect()
}

fn rust_files(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(directory).expect("read UI directory") {
        let path = entry.expect("read UI entry").path();
        if path.is_dir() {
            rust_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
}

#[test]
fn ui_has_no_unlocalized_string_literals() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    rust_files(&root.join("apps/desktop/src/ui"), &mut files);
    rust_files(&root.join("crates/study-ui/src"), &mut files);
    let scanned: Vec<(PathBuf, StringLiterals)> = files
        .into_iter()
        .map(|path| {
            let source = fs::read_to_string(&path).expect("read UI source");
            let literals = literals_in_file(&source, &path);
            (path, literals)
        })
        .collect();
    let test_only: Vec<PathBuf> = scanned
        .iter()
        .flat_map(|(path, literals)| test_module_paths(path, &literals.test_modules))
        .collect();
    let mut violations = Vec::new();

    for (path, literals) in scanned {
        if test_only.iter().any(|excluded| path.starts_with(excluded)) {
            continue;
        }
        for literal in literals.literals {
            let bundled_font_path =
                literal.starts_with("../assets/fonts/") && literal.ends_with(".ttf");
            // A string of only spaces or line breaks shows no words, so it is not copy.
            if !bundled_font_path
                && !literal.trim().is_empty()
                // Font names, which are not copy.
                && !["Inter", "Excalifont", ".SystemUIFont"].contains(&literal.as_str())
            {
                violations.push(format!("{}: {literal:?}", path.display()));
            }
        }
    }

    assert!(
        violations.is_empty(),
        "UI text must come from study-localization:\n{}",
        violations.join("\n")
    );
}

#[test]
fn element_ids_are_not_copy_but_sentences_in_tuples_are() {
    let source = r#"const JOB: &str = "job-row"; const TITLE: &str = "Hello";
        fn render() { let a = ("quiz-choice", 3); let b = ("Hello there", 1); }"#;
    assert_eq!(literals_in(source), ["Hello", "Hello there"]);
}

#[test]
fn expect_messages_are_not_copy() {
    let source = r#"fn render() {
        let window = open("Visible").expect("failed to open window");
    }"#;
    assert_eq!(literals_in(source), ["Visible"]);
}

#[test]
fn scanner_catches_direct_and_macro_copy() {
    let source = r#"fn render() { let title = "Visible"; let _ = format!("Hello, {title}"); }"#;
    assert_eq!(literals_in(source), ["Visible", "Hello, {title}"]);
}

#[test]
fn copy_scan_excludes_test_only_fixtures_but_checks_production() {
    assert_eq!(
        literals_in(
            r#"fn label() { let _ = "visible"; } #[cfg(test)] mod tests { fn keyboard() { let _ = "enter"; } }"#
        ),
        vec!["visible"]
    );
}

#[test]
fn copy_scan_skips_out_of_line_test_modules() {
    let scanned = literals_in_file(
        r#"#[cfg(test)] mod tests; mod page; fn label() { let _ = "visible"; }"#,
        Path::new("<inline>"),
    );
    assert_eq!(scanned.literals, ["visible"]);
    assert_eq!(scanned.test_modules, ["tests"]);
    assert_eq!(
        test_module_paths(Path::new("ui/sessions/mod.rs"), &scanned.test_modules),
        [
            PathBuf::from("ui/sessions/tests.rs"),
            PathBuf::from("ui/sessions/tests")
        ]
    );
}
