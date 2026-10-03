//! [`Recognizer`]: open, render pages, batch through the provider, join in order.

use std::sync::Arc;

use futures::future::BoxFuture;
use futures::{StreamExt as _, TryStreamExt as _};
use study_media::pages::{DocumentInput, PageImage, Pages};

use crate::blocking::blocking;
use crate::vision::error::{Error, Result};
use crate::vision::provider::{Limits, Provider, ProviderConfig};
use crate::vision::recognized::{PageText, Recognized};
use crate::{BatchLimits, BatchWork, Batcher, BatchingConfig, Key, KeyHasher};

/// Who fails when a page cannot be opened or rendered.
const DECODER: &str = "page decoder";

/// What a [`Recognizer`] starts with.
#[derive(Clone, Debug)]
pub struct RecognizerConfig {
    /// The backend that reads the pages.
    pub provider: ProviderConfig,
    /// How pages are gathered into the provider's batches.
    pub batching: BatchingConfig,
}

impl RecognizerConfig {
    /// Pages read by `provider`, batched as usual.
    pub fn new(provider: ProviderConfig) -> Self {
        Self {
            provider,
            batching: BatchingConfig::default(),
        }
    }
}

/// Turns images and PDFs into text through whichever provider it was started with.
///
/// Cloning is cheap and clones share one queue, so concurrent calls on one recognizer are
/// batched together; the pipeline starts one per document it reads.
#[derive(Clone)]
pub struct Recognizer {
    inner: Arc<Inner>,
}

struct Inner {
    batcher: Batcher<Work>,
    provider: &'static str,
    limits: Limits,
}

impl Recognizer {
    /// Prepares the provider and starts the batching task on the current Tokio runtime.
    pub fn start(config: RecognizerConfig) -> Self {
        let provider = config.provider.build();
        let inner = Inner {
            provider: provider.name(),
            limits: provider.limits(),
            batcher: Batcher::spawn(Arc::new(Work(provider)), config.batching),
        };
        Self {
            inner: Arc::new(inner),
        }
    }

    /// The provider's stable name, recorded with what it read.
    pub fn provider_name(&self) -> &'static str {
        self.inner.provider
    }

    /// Opens the input, renders its pages at the size the provider wants, reads them through
    /// the shared batch queue, and joins the text in page order.
    ///
    /// Only enough pages to keep the provider busy are rendered ahead, so memory stays flat
    /// however long the document is.
    ///
    /// A page the model answered with nothing usable (its content filter stopped it, or the
    /// answer was cut short) is kept empty, so one page never fails the rest: failing would
    /// lose the document for good, or read and bill every page again on each retry. What
    /// stops the reading itself (no sign-in, a rate limit, the network) still fails it.
    pub async fn recognize(&self, input: impl Into<DocumentInput>) -> Result<Recognized> {
        let input = input.into();
        let source = blocking(DECODER, move || Ok::<_, Error>(Pages::open(input)?)).await?;
        let limits = self.inner.limits;
        let ahead =
            (limits.batch.max_batch_size * limits.batch.max_concurrent_batches).clamp(2, 64);
        let pages = futures::stream::iter(0..source.page_count())
            .map(|index| {
                let source = source.clone();
                async move {
                    let (page, key) = blocking(DECODER, move || {
                        let page = source.page(index, limits.max_image_side)?;
                        let key = page_key(&page);
                        Ok::<_, Error>((page, key))
                    })
                    .await?;
                    let text = match self.inner.batcher.submit(page, key).await {
                        Ok(text) => text,
                        Err(error) if unusable(&error) => {
                            tracing::warn!(
                                page = index + 1,
                                %error,
                                "a page has no usable reading; kept empty"
                            );
                            String::new()
                        }
                        Err(error) => return Err(error),
                    };
                    Ok::<_, Error>(PageText {
                        number: index + 1,
                        text,
                    })
                }
            })
            .buffered(ahead)
            .try_collect::<Vec<_>>()
            .await?;
        Ok(Recognized::stitch(pages))
    }
}

/// Whether `error` is the model's answer to one page being unusable, rather than a reason
/// to stop reading.
fn unusable(error: &Error) -> bool {
    matches!(error, Error::Model(error) if error.is_unusable_answer())
}

/// Identical pages: same size and same pixels.
fn page_key(page: &PageImage) -> Key {
    let mut hasher = KeyHasher::default();
    hasher
        .update(page.width().to_le_bytes())
        .update(page.height().to_le_bytes())
        .update(page.rgb().as_raw());
    hasher.finish()
}

/// Lets the shared batch queue drive a provider.
struct Work(Arc<dyn Provider>);

impl BatchWork for Work {
    type Item = PageImage;
    type Output = String;
    type Error = Error;

    fn name(&self) -> &'static str {
        self.0.name()
    }

    fn limits(&self) -> BatchLimits {
        self.0.limits().batch
    }

    fn run(&self, pages: Vec<PageImage>) -> BoxFuture<'_, Vec<Result<String>>> {
        self.0.read_batch(pages)
    }

    /// An identical page the model couldn't read stays unusable, so it is kept empty too.
    fn share(&self, error: &Error) -> Error {
        match error {
            Error::Model(model) => model.copy_unusable().map(Error::Model),
            _ => None,
        }
        .unwrap_or_else(|| crate::batch::shared(error).into())
    }
}
