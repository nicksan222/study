//! PDFs and raster images: every page seen by a language model that reads images (the
//! ChatGPT plan's medium tier), which writes out its text and what its figures, charts and
//! tables show. Its Markdown is split into paragraphs, each anchored to its page.

use study_ai::agent::AgentRuntime;
use study_ai::chat::Tier;
use study_ai::vision::{DocumentInput, ProviderConfig, Recognizer, RecognizerConfig};
use study_core::processing::{BoxFuture, Extractor, ExtractorKind, SourceInput};
use study_core::{Anchor, Block, BlockKind, Document, DocumentMeta, Failure};

use super::markdown_kind;

/// The tier whose model reads pages.
const TIER: Tier = Tier::Medium;

/// Where the extractor gets its recognizer's configuration.
enum Setup {
    /// Always this configuration, such as a test double.
    Fixed(RecognizerConfig),
    /// The model of [`TIER`] that the saved language model preferences set up, read again
    /// for every source.
    Saved(AgentRuntime),
}

/// Pages of PDFs and images, read by a model that sees them.
pub struct VisionExtractor {
    setup: Setup,
}

impl VisionExtractor {
    /// Always reads with `config`.
    pub fn new(config: RecognizerConfig) -> Self {
        Self {
            setup: Setup::Fixed(config),
        }
    }

    /// Reads with the medium tier's model of `agents`, as saved when each source is read.
    pub fn saved(agents: AgentRuntime) -> Self {
        Self {
            setup: Setup::Saved(agents),
        }
    }

    /// A reader for one document: its pages are batched together.
    async fn recognizer(&self) -> Result<Recognizer, Failure> {
        let config = match &self.setup {
            Setup::Fixed(config) => config.clone(),
            Setup::Saved(agents) => {
                let models = agents.required_models(TIER).await?;
                let language = agents.language().await?;
                RecognizerConfig::new(ProviderConfig::Model(models.model(TIER), language))
            }
        };
        Ok(Recognizer::start(config))
    }
}

impl Extractor for VisionExtractor {
    fn kind(&self) -> ExtractorKind {
        ExtractorKind::Vision
    }

    fn version(&self) -> u32 {
        1
    }

    fn extract(&self, input: SourceInput) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            let recognizer = self.recognizer().await?;
            let read = recognizer
                .recognize(DocumentInput::Encoded {
                    kind: Some(input.kind),
                    bytes: input.bytes,
                })
                .await?;
            let page_count = u32::try_from(read.pages.len()).unwrap_or(u32::MAX);
            let blocks = read
                .pages
                .iter()
                .flat_map(|page| {
                    let number = u32::try_from(page.number).unwrap_or(u32::MAX);
                    markdown_blocks(&page.text).map(move |(kind, text)| Block {
                        kind,
                        text,
                        anchor: Anchor::Page { page: number },
                    })
                })
                .collect();
            Ok(Document {
                blocks,
                meta: DocumentMeta {
                    provider: Some(recognizer.provider_name().to_owned()),
                    page_count: Some(page_count),
                    ..DocumentMeta::default()
                },
            })
        })
    }
}

/// The paragraphs of a page's Markdown, with what each is: headings, tables and list items
/// apart from plain paragraphs.
fn markdown_blocks(markdown: &str) -> impl Iterator<Item = (BlockKind, String)> + '_ {
    markdown
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
        .map(|paragraph| (markdown_kind(paragraph), paragraph.to_owned()))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use study_ai::BatchLimits;
    use study_ai::vision::provider::{Limits, Provider};
    use study_ai::vision::{PageImage, Result as VisionResult};

    use super::*;
    use crate::extract::attachment;

    const PDF: &[u8] = include_bytes!("../../../study-media/tests/fixtures/two_pages.pdf");

    /// Answers every page with its size.
    struct PageSizes;

    impl Provider for PageSizes {
        fn name(&self) -> &'static str {
            "page-sizes"
        }

        fn limits(&self) -> Limits {
            Limits {
                max_image_side: 100,
                batch: BatchLimits {
                    max_batch_size: 4,
                    max_concurrent_batches: 1,
                },
            }
        }

        fn read_batch(&self, pages: Vec<PageImage>) -> BoxFuture<'_, Vec<VisionResult<String>>> {
            Box::pin(async move {
                pages
                    .iter()
                    .map(|page| Ok(format!("# {}x{}\n\nBody", page.width(), page.height())))
                    .collect()
            })
        }
    }

    #[tokio::test]
    async fn every_page_becomes_blocks_anchored_to_it() -> study_core::Result<()> {
        let extractor = VisionExtractor::new(RecognizerConfig::new(ProviderConfig::Custom(
            Arc::new(PageSizes),
        )));
        let document = extractor.extract(attachment("slides.pdf", PDF)).await?;
        let pages: Vec<_> = document
            .blocks
            .iter()
            .map(|block| (block.kind, block.anchor.clone()))
            .collect();
        assert_eq!(
            pages,
            [
                (BlockKind::Heading, Anchor::Page { page: 1 }),
                (BlockKind::Paragraph, Anchor::Page { page: 1 }),
                (BlockKind::Heading, Anchor::Page { page: 2 }),
                (BlockKind::Paragraph, Anchor::Page { page: 2 }),
            ]
        );
        assert_eq!(document.meta.page_count, Some(2));
        assert_eq!(document.blocks[0].text, "# 77x100");
        Ok(())
    }

    #[test]
    fn tables_and_lists_are_told_apart() {
        let kinds: Vec<_> = markdown_blocks("| a | b |\n|---|---|\n\n- one\n\nplain")
            .map(|(kind, _)| kind)
            .collect();
        assert_eq!(
            kinds,
            [BlockKind::Table, BlockKind::ListItem, BlockKind::Paragraph]
        );
    }
}
