//! The rules `ROUTES` keeps: what reads each kind of file, step order, and no step
//! listed twice or hidden behind a broader route.

use std::collections::BTreeSet;

use super::*;
use crate::processing::{ProcessingPreferences, SourcePlan};
use crate::sniff;

/// Which extractor reads a file of this name first by default, once sniffed; `None` when
/// nothing reads it. A new route, or a reader switched off by default, changes this.
const READS: &[(&str, Option<ExtractorKind>)] = &[
    ("lecture.mp3", Some(ExtractorKind::Transcription)),
    ("lecture.m4a", Some(ExtractorKind::Transcription)),
    ("clip.mp4", Some(ExtractorKind::Transcription)),
    ("slides.pdf", Some(ExtractorKind::Vision)),
    ("photo.png", Some(ExtractorKind::Vision)),
    ("drawing.svg", None),
    ("essay.docx", Some(ExtractorKind::Office)),
    ("deck.pptx", Some(ExtractorKind::Office)),
    ("essay.doc", None),
    ("essay.odt", None),
    ("book.epub", None),
    ("sheet.xlsx", None),
    ("page.html", Some(ExtractorKind::Web)),
    ("notes.txt", Some(ExtractorKind::Text)),
    ("notes.md", Some(ExtractorKind::Text)),
    ("main.rs", Some(ExtractorKind::Text)),
    ("data.csv", Some(ExtractorKind::Text)),
    ("bundle.zip", None),
];

#[test]
fn sniffed_files_reach_the_expected_extractor() {
    for (name, expected) in READS {
        let detected = sniff(name, &[]);
        let plan = ProcessingPreferences::default().plan(detected.kind, detected.mime);
        assert_eq!(
            plan.extractors.first().copied(),
            *expected,
            "{name} ({detected:?})"
        );
    }
}

#[test]
fn every_extractor_kind_reads_something() {
    for kind in ExtractorKind::ALL {
        assert!(
            READS.iter().any(|(_, expected)| *expected == Some(*kind)),
            "{kind:?} is in no route of READS"
        );
    }
}

#[test]
fn every_refiner_and_material_kind_is_in_some_route() {
    for kind in RefinerKind::ALL {
        assert!(
            ROUTES
                .iter()
                .any(|route| route.refiners.iter().any(|step| step.kind == *kind)),
            "{kind:?} is in no route"
        );
    }
    for kind in ArtifactKind::ALL {
        assert!(
            ROUTES
                .iter()
                .any(|route| route.enhancers.iter().any(|step| step.kind == *kind)),
            "{kind:?} is in no route"
        );
    }
}

fn distinct<K: Ord + Copy>(steps: &[Step<K>]) -> bool {
    steps
        .iter()
        .map(|step| step.kind)
        .collect::<BTreeSet<_>>()
        .len()
        == steps.len()
}

#[test]
fn routes_list_stages_that_follow_reading_and_nothing_twice() {
    for route in ROUTES {
        for step in route.stages {
            assert!(
                step.kind.follows_reading(),
                "{:?} lists {:?}",
                route.source,
                step.kind
            );
        }
        assert!(
            distinct(route.extractors)
                && distinct(route.refiners)
                && distinct(route.stages)
                && distinct(route.enhancers),
            "{:?} lists a processor twice",
            route.source
        );
    }
}

#[test]
fn no_route_is_hidden_behind_a_broader_one() {
    for (index, route) in ROUTES.iter().enumerate() {
        if route.media == Media::Any {
            assert!(
                ROUTES[index + 1..]
                    .iter()
                    .all(|later| later.source != route.source),
                "a later {:?} route is never reached",
                route.source
            );
        }
    }
}

#[test]
fn routes_of_one_kind_agree() {
    for (index, first) in ROUTES.iter().enumerate() {
        for second in ROUTES[index + 1..]
            .iter()
            .filter(|route| route.source == first.source)
        {
            for (processor, on) in first.processors() {
                for (other, other_on) in second.processors() {
                    if other == processor {
                        assert_eq!(on, other_on, "{:?} {processor:?}", first.source);
                    }
                }
            }
            let needs = |route: &Route| route.extractors.first().and_then(|s| s.kind.requirement());
            assert_eq!(needs(first), needs(second), "{:?}", first.source);
        }
    }
}

#[test]
fn the_whitespace_tidy_comes_last_and_foundations_first() {
    for route in ROUTES {
        if let Some(at) = route
            .refiners
            .iter()
            .position(|step| step.kind == RefinerKind::Whitespace)
        {
            assert_eq!(at + 1, route.refiners.len(), "{:?}", route.source);
        }
        for (at, step) in route.stages.iter().enumerate() {
            if let Some(base) = step.kind.builds_on() {
                assert!(
                    route.stages[..at]
                        .iter()
                        .any(|earlier| earlier.kind == base),
                    "{:?} lists {:?} before {base:?}",
                    route.source,
                    step.kind
                );
            }
        }
    }
}

#[test]
fn every_fetcher_is_tried_once_and_page_last() {
    let tried: BTreeSet<_> = FETCHERS.iter().copied().collect();
    assert_eq!(tried.len(), FETCHERS.len());
    assert_eq!(tried, FetcherKind::ALL.iter().copied().collect());
    assert_eq!(FETCHERS.last(), Some(&FetcherKind::Page));
}

#[test]
fn a_kind_is_read_first_by_its_first_routes_first_extractor() {
    assert_eq!(
        first_extractor(SourceKind::Video),
        Some(ExtractorKind::Transcription)
    );
    assert_eq!(
        first_extractor(SourceKind::Pdf),
        Some(ExtractorKind::Vision)
    );
    // HTML comes first among code, and needs what the rest of code needs: nothing.
    assert_eq!(first_extractor(SourceKind::Code), Some(ExtractorKind::Web));
    assert_eq!(first_extractor(SourceKind::Archive), None);
}

#[test]
fn a_link_has_no_route_until_its_fetch_brings_it_in() {
    assert!(route(SourceKind::Link, crate::mime::URI_LIST).is_none());
    assert_eq!(first_extractor(SourceKind::Link), None);
    let plan = ProcessingPreferences::default().plan(SourceKind::Link, crate::mime::URI_LIST);
    assert_eq!(plan, SourcePlan::default());
}

#[test]
fn reads_need_what_their_extractor_needs() {
    let read = |kind| requirement(JobKind::Extract, first_extractor(kind));
    assert_eq!(read(SourceKind::Audio), Some(Requirement::Transcription));
    assert_eq!(read(SourceKind::Image), Some(Requirement::LanguageModels));
    assert_eq!(read(SourceKind::Text), None);
    assert_eq!(read(SourceKind::Archive), None);
    assert_eq!(requirement(JobKind::Extract, None), None);
    assert_eq!(
        requirement(JobKind::Embed, None),
        Some(Requirement::SearchModel)
    );
    assert_eq!(
        requirement(JobKind::Artifact, None),
        Some(Requirement::LanguageModels)
    );
    for &kind in JobKind::ALL {
        assert_eq!(
            requirement(kind, None) == Some(Requirement::LanguageModels),
            kind.needs_language_model(),
            "{kind:?}"
        );
    }
}
