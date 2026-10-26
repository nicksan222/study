//! Plans built from the route defaults and the user's switches.

use super::*;

#[test]
fn a_plan_follows_the_route_defaults() {
    let plan = ProcessingPreferences::default().plan(SourceKind::Audio, "audio/mpeg");
    assert_eq!(plan.extractors, [ExtractorKind::Transcription]);
    assert_eq!(
        plan.refiners,
        [RefinerKind::Transcript, RefinerKind::Whitespace]
    );
    assert_eq!(plan.stages, [JobKind::Index, JobKind::Embed]);
    assert!(plan.enhancers.contains(&ArtifactKind::Diagram));
    assert_eq!(plan.after(JobKind::Extract), Some(JobKind::Index));
    assert_eq!(plan.after(JobKind::Index), Some(JobKind::Embed));
    assert_eq!(plan.after(JobKind::Embed), None);

    let code = ProcessingPreferences::default().plan(SourceKind::Code, "text/plain");
    assert!(code.refiners.is_empty(), "off by default for code");
    assert!(
        !ProcessingPreferences::default()
            .plan(SourceKind::Archive, "application/zip")
            .reads()
    );
}

#[test]
fn overrides_switch_processors_and_embed_needs_index() {
    let mut preferences = ProcessingPreferences::default();
    preferences.set(SourceKind::Pdf, Processor::Stage(JobKind::Index), false);
    preferences.set(
        SourceKind::Code,
        Processor::Refiner(RefinerKind::Whitespace),
        true,
    );
    let pdf = preferences.plan(SourceKind::Pdf, "application/pdf");
    assert!(pdf.stages.is_empty(), "no passages, nothing to embed");
    assert_eq!(pdf.after(JobKind::Extract), None);
    // Both code routes follow the one switch of their kind.
    for mime in ["text/plain", "text/html"] {
        assert_eq!(
            preferences.plan(SourceKind::Code, mime).refiners,
            [RefinerKind::Whitespace]
        );
    }
    // Back to the default forgets the override.
    preferences.set(SourceKind::Pdf, Processor::Stage(JobKind::Index), true);
    preferences.set(
        SourceKind::Code,
        Processor::Refiner(RefinerKind::Whitespace),
        false,
    );
    assert_eq!(preferences, ProcessingPreferences::default());
}

#[test]
fn switched_off_stages_leave_the_plan_and_take_what_builds_on_them() {
    let mut preferences = ProcessingPreferences::default();
    preferences.set(SourceKind::Pdf, Processor::Stage(JobKind::Embed), false);
    let plan = preferences.plan(SourceKind::Pdf, "application/pdf");
    assert_eq!(plan.after(JobKind::Extract), Some(JobKind::Index));
    assert_eq!(plan.after(JobKind::Index), None);
    assert!(!plan.includes(JobKind::Embed));
    assert!(plan.includes(JobKind::Extract) && plan.includes(JobKind::Index));
    let mut preferences = ProcessingPreferences::default();
    preferences.set(SourceKind::Audio, Processor::Stage(JobKind::Index), false);
    preferences.set(SourceKind::Audio, Processor::Stage(JobKind::Embed), true);
    let plan = preferences.plan(SourceKind::Audio, "audio/mpeg");
    assert!(!plan.stages.contains(&JobKind::Index));
    assert_eq!(plan.after(JobKind::Index), None, "embed needs index");
}

#[test]
fn switches_of_a_kind_with_two_routes_come_once_each_by_family() {
    let switches = ProcessingPreferences::default().switches(SourceKind::Code);
    let processors: Vec<Processor> = switches.iter().map(|s| s.processor).collect();
    assert_eq!(
        processors[..2],
        [
            Processor::Extractor(ExtractorKind::Web),
            Processor::Extractor(ExtractorKind::Text)
        ]
    );
    assert_eq!(processors[2], Processor::Refiner(RefinerKind::Whitespace));
    let mut unique = processors.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), processors.len());
    // Switching off the page reader does not fall through to the text reader.
    let mut preferences = ProcessingPreferences::default();
    preferences.set(
        SourceKind::Code,
        Processor::Extractor(ExtractorKind::Web),
        false,
    );
    assert!(!preferences.plan(SourceKind::Code, "text/html").reads());
    assert!(preferences.plan(SourceKind::Code, "text/plain").reads());
}

#[test]
fn setting_a_processor_no_route_offers_is_ignored() {
    let mut preferences = ProcessingPreferences::default();
    preferences.set(
        SourceKind::Audio,
        Processor::Extractor(ExtractorKind::Office),
        true,
    );
    preferences.set(
        SourceKind::Archive,
        Processor::Extractor(ExtractorKind::Text),
        true,
    );
    assert_eq!(preferences, ProcessingPreferences::default());
    assert!(!preferences.is_on(
        SourceKind::Audio,
        Processor::Extractor(ExtractorKind::Office)
    ));
}
