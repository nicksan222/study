//! [`Family`]: the kind each processor family is registered by, so `study-pipeline` keeps
//! every family the same way, exactly one implementation per kind.

use std::fmt::Debug;
use std::hash::Hash;

use crate::ArtifactKind;

use super::{Enhancer, Extractor, ExtractorKind, Fetcher, FetcherKind, Refiner, RefinerKind};

/// A processor family, implemented by its trait object (such as `dyn Extractor`): the kind
/// enum its implementations are filed under, and every kind, each of which needs one.
pub trait Family {
    /// What tells the implementations apart, such as [`ExtractorKind`].
    type Kind: Copy + Eq + Hash + Debug + 'static;

    /// Every kind; a completeness test asserts each has an implementation.
    const KINDS: &'static [Self::Kind];

    /// The kind `processor` reports (its own `kind()`), so where it is filed and what it
    /// says it is never disagree.
    fn kind_of(processor: &Self) -> Self::Kind;
}

impl Family for dyn Fetcher + '_ {
    type Kind = FetcherKind;
    const KINDS: &'static [FetcherKind] = FetcherKind::ALL;

    fn kind_of(processor: &Self) -> FetcherKind {
        processor.kind()
    }
}

impl Family for dyn Extractor + '_ {
    type Kind = ExtractorKind;
    const KINDS: &'static [ExtractorKind] = ExtractorKind::ALL;

    fn kind_of(processor: &Self) -> ExtractorKind {
        processor.kind()
    }
}

impl Family for dyn Refiner + '_ {
    type Kind = RefinerKind;
    const KINDS: &'static [RefinerKind] = RefinerKind::ALL;

    fn kind_of(processor: &Self) -> RefinerKind {
        processor.kind()
    }
}

impl Family for dyn Enhancer + '_ {
    type Kind = ArtifactKind;
    const KINDS: &'static [ArtifactKind] = ArtifactKind::ALL;

    fn kind_of(processor: &Self) -> ArtifactKind {
        processor.kind()
    }
}
