//! [`ModelProvider`]: pages read by a language model that sees images, today the one on
//! the user's ChatGPT plan. It does not transcribe like an OCR engine: it writes out what a
//! student needs from the page, figures and diagrams included, so the page can be studied
//! from the text alone.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use futures::future::{BoxFuture, join_all};
use rig_agent::completion::Prompt as _;
use rig_agent::{Agent, AgentBuilder, ModelHandle};
use rig_core::message::{
    DocumentSourceKind, Image, ImageDetail, ImageMediaType, Message, UserContent,
};
use study_core::Language;
use study_media::pages::{PageImage, encode_png};

use super::{Limits, Provider};
use crate::BatchLimits;
use crate::agent::language_instruction;
use crate::blocking::blocking;
use crate::vision::error::Result;

const NAME: &str = "language-model";

/// What the model is asked to make of each page.
const INSTRUCTIONS: &str = "You read pages of a student's study material: lecture slides, \
textbook and handout pages, handwritten notes, photos of a whiteboard. Write out, as Markdown, \
everything a student needs from the page, so they can study from your text alone without \
seeing it:
- All its text, in reading order, with its headings, lists and emphasis. Read handwriting \
carefully.
- Tables as Markdown tables, and formulas in LaTeX between $ signs.
- Every figure, chart, graph, diagram or photo that carries meaning: what it shows and what \
it means (axes and trends, labels, arrows and how the parts connect), in a short paragraph \
that starts with **Figure:**.
- Nothing for decoration: logos, page numbers, headers and footers that repeat.
Add nothing that is not on the page. Copy the page's own text in its own language, without \
translating it; write your figure descriptions for the student, in the language named below. \
Reply with the Markdown only; for a page with nothing on it, reply with nothing.";

/// What goes with each page.
const PROMPT: &str = "Read this page.";

/// Reads pages with a model that accepts images.
pub struct ModelProvider {
    agent: Agent,
}

impl ModelProvider {
    /// Reads with `model`, describing figures for a student who reads `language`.
    pub fn new(model: ModelHandle, language: Language) -> Self {
        let instructions = format!("{INSTRUCTIONS}\n\n{}", language_instruction(language));
        let agent = AgentBuilder::from_model_handle(model)
            .name("page-reader")
            .preamble(&instructions)
            .build();
        Self { agent }
    }

    async fn read(&self, page: PageImage) -> Result<String> {
        let png = blocking(NAME, move || Ok::<_, crate::Error>(encode_png(&page))).await?;
        let image = Image {
            data: DocumentSourceKind::Base64(BASE64.encode(&png)),
            media_type: Some(ImageMediaType::PNG),
            detail: Some(ImageDetail::High),
            additional_params: None,
        };
        let message = Message::User {
            content: vec![UserContent::text(PROMPT), UserContent::Image(image)],
        };
        let answer = self
            .agent
            .prompt(message)
            .await
            .map_err(crate::chat::Error::from)?;
        Ok(strip_fence(&answer).to_owned())
    }
}

impl Provider for ModelProvider {
    fn name(&self) -> &'static str {
        NAME
    }

    fn limits(&self) -> Limits {
        Limits {
            // High-detail images are scaled to fit 2048 px anyway; more only costs upload.
            max_image_side: 2_048,
            // Each page is its own request: at most eight at once per document, and the
            // Reading lane reads two documents at a time.
            batch: BatchLimits {
                max_batch_size: 4,
                max_concurrent_batches: 2,
            },
        }
    }

    fn read_batch(&self, pages: Vec<PageImage>) -> BoxFuture<'_, Vec<Result<String>>> {
        Box::pin(join_all(pages.into_iter().map(|page| self.read(page))))
    }
}

/// Models sometimes wrap their whole answer in a Markdown code fence; the fence is not part
/// of the page.
fn strip_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let Some((info, body)) = rest.split_once('\n') else {
        return trimmed;
    };
    if !matches!(info.trim(), "" | "markdown" | "md") {
        return trimmed;
    }
    body.trim_end()
        .strip_suffix("```")
        .map_or(trimmed, str::trim)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fence_around_the_whole_answer_is_removed() {
        assert_eq!(
            strip_fence("```markdown\n# Title\n\nText\n```"),
            "# Title\n\nText"
        );
        assert_eq!(strip_fence("  ```\nplain\n```  "), "plain");
    }

    #[test]
    fn other_text_is_only_trimmed() {
        assert_eq!(strip_fence("  # Title \n"), "# Title");
        // A code block that is part of the page stays.
        let code = "```python\nprint(1)\n```";
        assert_eq!(strip_fence(code), code);
        assert_eq!(
            strip_fence("```markdown\nunterminated"),
            "```markdown\nunterminated"
        );
    }
}
