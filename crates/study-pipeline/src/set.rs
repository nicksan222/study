//! [`ProcessorSet`]: the implementations of one processor [`Family`], exactly one per kind.
//! Each family's set (such as [`ExtractorSet`](crate::ExtractorSet)) is one of these.

use std::collections::HashMap;
use std::sync::Arc;

use study_core::processing::Family;

/// One implementation per kind of the family `P`, such as every extractor by its
/// `ExtractorKind`. Clones share the implementations.
pub struct ProcessorSet<P: ?Sized + Family> {
    by_kind: HashMap<P::Kind, Arc<P>>,
}

impl<P: ?Sized + Family> Clone for ProcessorSet<P> {
    fn clone(&self) -> Self {
        Self {
            by_kind: self.by_kind.clone(),
        }
    }
}

impl<P: ?Sized + Family> Default for ProcessorSet<P> {
    fn default() -> Self {
        Self {
            by_kind: HashMap::new(),
        }
    }
}

impl<P: ?Sized + Family> ProcessorSet<P> {
    /// A set of exactly `processors`, each filed under the kind it reports. Two of one kind
    /// is a mistake in the list, and panics in debug builds.
    pub fn new(processors: Vec<Arc<P>>) -> Self {
        let mut by_kind = HashMap::new();
        for processor in processors {
            let kind = P::kind_of(&processor);
            let replaced = by_kind.insert(kind, processor);
            debug_assert!(replaced.is_none(), "two processors of kind {kind:?}");
        }
        Self { by_kind }
    }

    /// The implementation of `kind`.
    pub fn get(&self, kind: P::Kind) -> Option<&Arc<P>> {
        self.by_kind.get(&kind)
    }

    /// The kinds with no implementation: what each family's completeness test asserts
    /// empty.
    pub fn missing(&self) -> Vec<P::Kind> {
        P::KINDS
            .iter()
            .copied()
            .filter(|kind| !self.by_kind.contains_key(kind))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use study_core::processing::{BoxFuture, Fetched, Fetcher, FetcherKind};
    use study_core::{ErrorKind, Failure};

    use super::ProcessorSet;

    /// Accepts nothing, as the page kind.
    struct Idle;

    impl Fetcher for Idle {
        fn kind(&self) -> FetcherKind {
            FetcherKind::Page
        }

        fn accepts(&self, _: &str) -> bool {
            false
        }

        fn fetch<'a>(&'a self, _: &'a str) -> BoxFuture<'a, Result<Fetched, Failure>> {
            Box::pin(async { Err(Failure::new(ErrorKind::Unsupported, "idle")) })
        }
    }

    #[test]
    fn processors_are_filed_by_the_kind_they_report_and_gaps_are_listed() {
        let set: ProcessorSet<dyn Fetcher> = ProcessorSet::new(vec![Arc::new(Idle)]);
        assert!(set.get(FetcherKind::Page).is_some());
        assert!(set.get(FetcherKind::Video).is_none());
        assert_eq!(set.missing(), [FetcherKind::Video]);
    }
}
