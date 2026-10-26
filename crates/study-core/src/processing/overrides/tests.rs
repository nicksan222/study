//! Saving and loading the user's processor switches.

use super::*;
use crate::{ArtifactKind, JobKind};

#[test]
fn overrides_are_saved_and_loaded() {
    let (_dir, database) = crate::db::Database::temporary().unwrap();
    let mut preferences = ProcessingPreferences::default();
    preferences.set(
        SourceKind::Audio,
        Processor::Enhancer(ArtifactKind::Diagram),
        false,
    );
    preferences.save(&database).unwrap();
    let loaded = ProcessingPreferences::load(&database).unwrap();
    assert_eq!(loaded, preferences);
    assert!(!loaded.is_on(
        SourceKind::Audio,
        Processor::Enhancer(ArtifactKind::Diagram)
    ));
    let switches = loaded.switches(SourceKind::Audio);
    assert!(switches.iter().any(|switch| switch.processor
        == Processor::Enhancer(ArtifactKind::Diagram)
        && switch.default
        && !switch.on));
}

#[test]
fn switches_saved_one_at_a_time_keep_each_other() {
    let (_dir, database) = crate::db::Database::temporary().unwrap();
    let diagram = Processor::Enhancer(ArtifactKind::Diagram);
    ProcessingPreferences::save_switch(&database, SourceKind::Audio, diagram, false).unwrap();
    ProcessingPreferences::save_switch(&database, SourceKind::Pdf, diagram, false).unwrap();
    let loaded = ProcessingPreferences::load(&database).unwrap();
    assert!(!loaded.is_on(SourceKind::Audio, diagram) && !loaded.is_on(SourceKind::Pdf, diagram));
    // Back to the default removes the row.
    ProcessingPreferences::save_switch(&database, SourceKind::Audio, diagram, true).unwrap();
    ProcessingPreferences::save_switch(&database, SourceKind::Pdf, diagram, true).unwrap();
    assert_eq!(
        ProcessingPreferences::load(&database).unwrap(),
        ProcessingPreferences::default()
    );
}

#[test]
fn unknown_and_unreadable_switches_are_dropped_on_load() {
    let (_dir, database) = crate::db::Database::temporary().unwrap();
    database
        .save_preferences(
            ProcessingPreferences::SCOPE,
            &[
                ("audio.extractor.gone", "false".into()),
                ("pdf.stage.embed", "\"not a bool\"".into()),
                ("pdf.stage.index", "false".into()),
                // Equal to the default: normalised away.
                ("audio.refiner.whitespace", "true".into()),
            ],
        )
        .unwrap();
    let loaded = ProcessingPreferences::load(&database).unwrap();
    let mut expected = ProcessingPreferences::default();
    expected.set(SourceKind::Pdf, Processor::Stage(JobKind::Index), false);
    assert_eq!(loaded, expected);
}
