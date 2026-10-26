//! The interface of every processor family, and what flows between them. `study-pipeline`
//! implements each trait once per kind; what is here only shapes their inputs and outputs:
//! sniffing what was fetched, fitting excerpts to a model's budget and citing them.

use futures::future::BoxFuture;

use crate::db::{Job, JobTarget};
use crate::jobs::Lane;
use crate::{
    Anchor, ArtifactBody, ArtifactKind, Citation, Document, Failure, JobKind, SourceId, SourceKind,
};

use super::{ExtractorKind, FetcherKind, RefinerKind, SourcePlan};

/// A stored source, ready to read.
#[derive(Clone, Debug)]
pub struct SourceInput {
    /// The name it was imported under. Only a hint (such as a decoder's extension); never
    /// used to decide what reads it.
    pub name: String,
    /// What it is, from [`sniff`](crate::sniff) on import.
    pub kind: SourceKind,
    /// Its media type, from the same sniff.
    pub mime: String,
    /// Where a web page or video came from.
    pub uri: Option<String>,
    /// The stored bytes.
    pub bytes: Vec<u8>,
}

/// Reads a source into its document. Which sources it reads is the routes' decision.
pub trait Extractor: Send + Sync + 'static {
    /// The kind it implements; each kind has one implementation.
    fn kind(&self) -> ExtractorKind;

    /// Starts at 1. Bump whenever the documents it produces change, so old ones are read
    /// again.
    fn version(&self) -> u32;

    /// Reads the source. Classify every failure; return
    /// [`ErrorKind::Unsupported`](crate::ErrorKind::Unsupported) to let the route's next
    /// extractor try instead.
    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>>;
}

/// Reworks a document after it was read, before it is stored. A refiner keeps every block's
/// anchor pointing where its text came from; merging blocks widens it with
/// [`Anchor::through`].
pub trait Refiner: Send + Sync + 'static {
    /// The kind it implements; each kind has one implementation.
    fn kind(&self) -> RefinerKind;

    /// Starts at 1. Bump whenever what it produces changes: documents record the refiners
    /// they went through, and identical bytes are read afresh after a bump.
    fn version(&self) -> u32;

    /// The reworked document. Its meta is kept whatever this returns.
    fn refine(&self, document: Document) -> BoxFuture<'_, Result<Document, Failure>>;
}

/// What a fetcher brought in, ready to store as a source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fetched {
    /// The name to list it under.
    pub name: String,
    pub bytes: Vec<u8>,
    pub kind: SourceKind,
    pub mime: String,
    /// Where it came from, after redirects.
    pub uri: String,
}

impl Fetched {
    /// `bytes` named `name`, with the kind and media type [`sniff`](crate::sniff) finds.
    pub fn sniffed(name: String, bytes: Vec<u8>, uri: String) -> Self {
        let detected = crate::sniff(&name, &bytes);
        Self {
            name,
            bytes,
            kind: detected.kind,
            mime: detected.mime.to_owned(),
            uri,
        }
    }
}

/// Brings in what one kind of address holds. Tried in the order of
/// [`FETCHERS`](super::FETCHERS).
pub trait Fetcher: Send + Sync + 'static {
    /// The kind it implements; each kind has one implementation.
    fn kind(&self) -> FetcherKind;

    /// Whether it fetches `url`.
    fn accepts(&self, url: &str) -> bool;

    /// Brings in what `url` holds. Needs the network.
    fn fetch<'a>(&'a self, url: &'a str) -> BoxFuture<'a, Result<Fetched, Failure>>;
}

/// An automatic step: reading ([`JobKind::Extract`]), or a stage a route lists after it,
/// each run as the job of its kind. It is only run while the source's plan still includes
/// it, gets that plan, and says what the next stage of the plan works on.
pub trait Stage: Send + Sync + 'static {
    /// The kind it implements; each kind has one implementation.
    fn kind(&self) -> JobKind;

    /// Which lane it runs on: [`Lane::Reading`] for reading sources with their models,
    /// [`Lane::Light`] for quick work, local embedding included.
    fn lane(&self) -> Lane;

    /// Does the work of `job` for a source whose plan is `plan`, and returns what the next
    /// stage should work on, or `None` when the pipeline stops here for this subject.
    fn run(&self, job: Job, plan: SourcePlan) -> BoxFuture<'_, Result<Option<JobTarget>, Failure>>;
}

/// Makes one kind of study material from numbered excerpts, when the user asks.
pub trait Enhancer: Send + Sync + 'static {
    /// The kind it implements; each kind has one implementation.
    fn kind(&self) -> ArtifactKind;

    /// The material, citing excerpts by their number in `material`.
    fn enhance<'a>(
        &'a self,
        material: &'a EnhancerInput,
    ) -> BoxFuture<'a, Result<ArtifactBody, Failure>>;
}

/// A passage an answer or study material may cite.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Excerpt {
    pub source_id: SourceId,
    pub source_name: String,
    pub anchor: Anchor,
    pub text: String,
}

impl Excerpt {
    /// The citation of this passage as `[marker]`.
    pub fn cite(&self, marker: u32) -> Citation {
        Citation {
            marker,
            source_id: Some(self.source_id),
            source_name: self.source_name.clone(),
            anchor: self.anchor.clone(),
            quote: self.text.clone(),
        }
    }
}

/// The citations of the passages `markers` name, numbered from 1 in `excerpts`, each once
/// and in marker order; a marker outside them is skipped.
pub fn citations(excerpts: &[Excerpt], markers: impl IntoIterator<Item = u32>) -> Vec<Citation> {
    let mut markers: Vec<u32> = markers.into_iter().collect();
    markers.sort_unstable();
    markers.dedup();
    markers
        .into_iter()
        .filter_map(|marker| {
            let excerpt = excerpts.get(usize::try_from(marker).ok()?.checked_sub(1)?)?;
            Some(excerpt.cite(marker))
        })
        .collect()
}

/// Most characters of passages one piece of material is written from, once sifted: about
/// thirty thousand tokens. Material covers a whole project, so a course of several lectures
/// fits in whole rather than as a sample, which a revision would read as content removed.
/// A project past it is still sampled, and an update may then drop what the passages shown
/// that time leave out.
const ENHANCER_INPUT_BUDGET: usize = 120_000;

/// What an enhancer works from: the numbered excerpts it may cite, the title of the
/// material, the project's notes, and the current text it revises, when there is one.
#[derive(Clone, Debug, Default)]
pub struct EnhancerInput {
    pub title: String,
    /// Numbered from 1 in this order.
    pub excerpts: Vec<Excerpt>,
    /// The notes of the project's sessions, one per line.
    pub notes: String,
    /// The current text this update replaces: it is revised, not written again from nothing. Not
    /// counted in the excerpt budget.
    pub previous: Option<ArtifactBody>,
}

impl EnhancerInput {
    /// The material from `excerpts`, [fitted](super::fit_excerpts) within the characters
    /// one piece of material is written from, about thirty thousand tokens.
    pub fn fit(
        title: String,
        notes: String,
        previous: Option<ArtifactBody>,
        excerpts: Vec<Excerpt>,
    ) -> Self {
        Self {
            title,
            excerpts: super::fit_excerpts(excerpts, ENHANCER_INPUT_BUDGET, &[]),
            notes,
            previous,
        }
    }
}
