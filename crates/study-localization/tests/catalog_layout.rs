//! Keeps `message.rs` and every catalog in the same sections and order, so any piece of
//! copy is found in the same place in every file.

use std::{fs, path::Path};

use study_localization::Locale;

/// A section header or a message, in file order.
#[derive(Debug, PartialEq)]
enum Entry {
    Section(String),
    Message(String),
}

fn source(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

/// The sections and variants of `enum Message`.
fn message_layout() -> Vec<Entry> {
    let source = source("src/message.rs");
    let body = source
        .split_once("pub enum Message {")
        .expect("message.rs declares `pub enum Message`")
        .1;
    body.lines()
        .map(str::trim)
        .filter_map(|line| {
            if let Some(section) = line.strip_prefix("// ") {
                Some(Entry::Section(section.to_owned()))
            } else if line.starts_with("///") || line.is_empty() || line == "}" {
                None
            } else {
                Some(Entry::Message(line.trim_end_matches(',').to_owned()))
            }
        })
        .collect()
}

/// The sections and match arms of a catalog.
fn catalog_layout(relative: &str) -> Vec<Entry> {
    let source = source(relative);
    let body = source
        .split_once("match message {")
        .expect("a catalog matches on the message")
        .1;
    body.lines()
        .map(str::trim)
        .filter_map(|line| {
            if let Some(section) = line.strip_prefix("// ") {
                Some(Entry::Section(section.to_owned()))
            } else {
                let arm = line.strip_prefix("Message::")?;
                let (name, _) = arm.split_once(" =>")?;
                Some(Entry::Message(name.to_owned()))
            }
        })
        .collect()
}

#[test]
fn every_message_sits_in_a_section() {
    let layout = message_layout();
    assert!(
        matches!(layout.first(), Some(Entry::Section(_))),
        "message.rs must open with a `// Screen: part` section comment"
    );
    assert!(
        layout
            .iter()
            .any(|entry| matches!(entry, Entry::Message(_)))
    );
}

/// Every catalog file in `src/catalog/`, so a new language is checked without editing this test.
fn catalog_files() -> Vec<String> {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/catalog");
    let mut files: Vec<String> = fs::read_dir(&directory)
        .unwrap_or_else(|error| panic!("read {}: {error}", directory.display()))
        .map(|entry| entry.expect("list src/catalog").file_name())
        .filter_map(|name| name.into_string().ok())
        .filter(|name| name.ends_with(".rs") && name != "mod.rs")
        .map(|name| format!("src/catalog/{name}"))
        .collect();
    files.sort();
    files
}

#[test]
fn there_is_one_catalog_per_locale() {
    let files = catalog_files();
    assert_eq!(
        files.len(),
        Locale::ALL.len(),
        "src/catalog/ holds {files:?} but Locale::ALL lists {:?}: add one catalog file per \
         locale (copy english.rs, translate every arm) and route it in `catalog::text`",
        Locale::ALL
    );
}

#[test]
fn catalogs_follow_the_message_order_and_sections() {
    let expected = message_layout();
    for catalog in catalog_files() {
        let actual = catalog_layout(&catalog);
        if let Some(index) = expected.iter().zip(&actual).position(|(a, b)| a != b) {
            panic!(
                "{catalog} differs from message.rs at entry {index}: expected {:?}, found {:?}. \
                 Put each arm at the same position as its variant in message.rs, under the same \
                 `// Screen: part` comment, copied verbatim",
                expected[index], actual[index]
            );
        }
        assert_eq!(
            expected.len(),
            actual.len(),
            "{catalog} and message.rs list a different number of sections and messages: the \
             shorter one is missing its tail"
        );
    }
}
