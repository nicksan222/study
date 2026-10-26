//! Generate the browser's protobuf consumer and bilingual catalog from canonical Rust sources.
use std::{collections::BTreeMap, fs, path::Path, process::Command};

use syn::{Expr, Item, Lit, Pat, Stmt};

use crate::Result;

pub fn run(check: bool) -> Result {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let temporary = tempfile::tempdir()?;
    let status = Command::new("protoc")
        .arg("-I")
        .arg(root.join("crates/study-rpc/proto"))
        .arg(format!(
            "--plugin=protoc-gen-es={}",
            root.join("node_modules/.bin/protoc-gen-es").display()
        ))
        .arg(format!("--es_out={}", temporary.path().display()))
        .args([
            "--es_opt=target=ts,import_extension=none",
            "study/v1/study.proto",
        ])
        .status()?;
    if !status.success() {
        return Err(format!("protoc exited with {status}").into());
    }
    let localization = root.join("crates/study-localization/src");
    let messages = fs::read_to_string(localization.join("message.rs"))?;
    let english = fs::read_to_string(localization.join("catalog/english.rs"))?;
    let italian = fs::read_to_string(localization.join("catalog/italian.rs"))?;
    let outputs = [
        (
            "study_pb.ts",
            fs::read_to_string(temporary.path().join("study/v1/study_pb.ts"))?,
        ),
        (
            "catalog.ts",
            catalog(&messages, &[("english", &english), ("italian", &italian)])?,
        ),
    ];
    let generated = root.join("apps/desktop/src/generated");
    if !check {
        fs::create_dir_all(&generated)?;
    }
    for (name, source) in outputs {
        let destination = generated.join(name);
        if check {
            if fs::read_to_string(&destination)? != source {
                return Err(format!(
                    "Stale generated file: {}; run just gen-protocol",
                    destination.display()
                )
                .into());
            }
        } else {
            fs::write(destination, source)?;
        }
    }
    Ok(())
}

fn literal(expression: &Expr) -> Result<String> {
    match expression {
        Expr::Lit(value) => match &value.lit {
            Lit::Str(value) => Ok(value.value()),
            _ => Err("catalog values must be Rust string literals".into()),
        },
        Expr::Block(block) => match block.block.stmts.as_slice() {
            [Stmt::Expr(expression, None)] => literal(expression),
            _ => Err("catalog blocks must contain one string literal".into()),
        },
        _ => Err("catalog values must be Rust string literals".into()),
    }
}

fn translations(source: &str) -> Result<BTreeMap<String, String>> {
    let syntax = syn::parse_file(source)?;
    let function = syntax
        .items
        .iter()
        .find_map(|item| match item {
            Item::Fn(function) if function.sig.ident == "text" => Some(function),
            _ => None,
        })
        .ok_or("catalog must declare text(message)")?;
    let [Stmt::Expr(Expr::Match(expression), None)] = function.block.stmts.as_slice() else {
        return Err("catalog text must match every message".into());
    };
    let mut values = BTreeMap::new();
    for arm in &expression.arms {
        let Pat::Path(path) = &arm.pat else {
            return Err("catalog arms must name a Message variant".into());
        };
        let segments: Vec<_> = path.path.segments.iter().collect();
        let [kind, message] = segments.as_slice() else {
            return Err("catalog arms must name Message::Variant".into());
        };
        if kind.ident != "Message" || arm.guard.is_some() {
            return Err("catalog arms must name an unconditional Message::Variant".into());
        }
        let name = message.ident.to_string();
        if values.insert(name.clone(), literal(&arm.body)?).is_some() {
            return Err(format!("duplicate catalog message: {name}").into());
        }
    }
    Ok(values)
}

fn catalog(messages: &str, languages: &[(&str, &str)]) -> Result<String> {
    let syntax = syn::parse_file(messages)?;
    let messages = syntax
        .items
        .iter()
        .find_map(|item| match item {
            Item::Enum(value) if value.ident == "Message" => Some(value),
            _ => None,
        })
        .ok_or("message.rs must declare enum Message")?;
    let keys: Vec<_> = messages
        .variants
        .iter()
        .map(|variant| variant.ident.to_string())
        .collect();
    let mut output = String::from(
        "// Generated from study-localization. Run bun run gen:protocol.\nexport const catalogs = {\n",
    );
    for (language_index, (language, source)) in languages.iter().enumerate() {
        let values = translations(source)?;
        if values.len() != keys.len() || keys.iter().any(|key| !values.contains_key(key)) {
            return Err(
                format!("Catalog {language} must translate every Message exactly once").into(),
            );
        }
        output.push_str(&format!("  {}: {{\n", serde_json::to_string(language)?));
        for (index, key) in keys.iter().enumerate() {
            let comma = if index + 1 == keys.len() { "" } else { "," };
            output.push_str(&format!(
                "    {}: {}{comma}\n",
                serde_json::to_string(key)?,
                serde_json::to_string(&values[key])?
            ));
        }
        output.push_str(if language_index + 1 == languages.len() {
            "  }\n"
        } else {
            "  },\n"
        });
    }
    output.push_str("} as const;\nexport type MessageKey = keyof typeof catalogs.english;\nexport type Locale = keyof typeof catalogs;\n");
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MESSAGES: &str = "pub enum Message { First, Second }";

    #[test]
    fn rust_literals_are_decoded_and_emitted_in_message_order() {
        let source = r##"fn text(message: Message) -> &'static str {
            match message {
                Message::Second => { r#"quote " and \ slash"# },
                Message::First => "line\n\u{1F600}",
            }
        }"##;
        let output = catalog(MESSAGES, &[("english", source)]).unwrap();
        assert!(output.contains(r#""First": "line\n😀""#));
        assert!(output.contains(r#""Second": "quote \" and \\ slash""#));
        assert!(output.find("First").unwrap() < output.find("Second").unwrap());
    }

    #[test]
    fn incomplete_duplicate_or_computed_catalogs_are_rejected() {
        for source in [
            "fn text(message: Message) { match message { Message::First => \"one\" } }",
            "fn text(message: Message) { match message { Message::First => \"one\", Message::First => \"again\", Message::Second => \"two\" } }",
            "fn text(message: Message) { match message { Message::First => computed(), Message::Second => \"two\" } }",
            "fn text(message: Message) { match message { _ => \"fallback\" } }",
        ] {
            assert!(
                catalog(MESSAGES, &[("english", source)]).is_err(),
                "{source}"
            );
        }
    }
}
