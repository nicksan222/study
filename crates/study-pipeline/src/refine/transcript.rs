//! Corrects what speech-to-text heard, with a language model on the ChatGPT plan: misheard
//! words and terms put right from the context, punctuation and capitals added, fillers
//! ("um", "uh") dropped. Nothing is summarized, reordered or translated.
//!
//! The transcript goes to the model in windows of numbered segments, and each comes back
//! as the same number of segments, so every block keeps the moment it was heard at. A window
//! whose answer does not line up, or has nothing usable, keeps the text it had; a window the
//! model could not answer at all (no sign-in, a rate limit, the network) fails the whole
//! correction. The read is then stored as heard, and corrected when background work next
//! starts or the user signs in (see `RefinerSet::refine`).

use std::fmt::Write as _;

use futures::{StreamExt as _, TryStreamExt as _};
use serde::Deserialize;
use study_ai::agent::{AgentRuntime, AgentSpec, Runner, escape, json_answer};
use study_ai::chat::Tier;
use study_core::processing::{BoxFuture, Refiner, RefinerKind};
use study_core::{Document, Failure};

/// Most segments the model corrects at once, so it sees enough to understand them.
const WINDOW_SEGMENTS: usize = 40;
/// Most characters of one window.
const WINDOW_CHARS: usize = 6_000;
/// Windows corrected at once.
const CONCURRENT_WINDOWS: usize = 3;

/// Corrects transcripts with [`TranscriptEditor`].
pub(super) struct TranscriptRefiner {
    agents: AgentRuntime,
}

impl TranscriptRefiner {
    /// Corrects with the medium tier's model of `agents`.
    pub fn new(agents: &AgentRuntime) -> Self {
        Self {
            agents: agents.clone(),
        }
    }
}

impl Refiner for TranscriptRefiner {
    fn kind(&self) -> RefinerKind {
        RefinerKind::Transcript
    }

    fn version(&self) -> u32 {
        1
    }

    fn refine(&self, mut document: Document) -> BoxFuture<'_, Result<Document, Failure>> {
        Box::pin(async move {
            let runner = self.agents.required::<TranscriptEditor>().await?;
            let texts: Vec<String> = document
                .blocks
                .iter()
                .map(|block| block.text.clone())
                .collect();
            let corrected: Vec<Vec<String>> = futures::stream::iter(windows(&texts))
                .map(|window| correct(&runner, &texts[window]))
                // `buffered`, not `buffer_unordered`: windows come back in order, so the zip
                // below lines each one up with its blocks.
                .buffered(CONCURRENT_WINDOWS)
                .try_collect()
                .await?;
            for (block, text) in document
                .blocks
                .iter_mut()
                .zip(corrected.into_iter().flatten())
            {
                block.text = text;
            }
            Ok(document)
        })
    }
}

/// One window of segments as corrected, or as heard when the answer does not line up or has
/// nothing usable in it.
async fn correct(
    runner: &Runner<TranscriptEditor>,
    segments: &[String],
) -> Result<Vec<String>, Failure> {
    let segments = segments.to_vec();
    match runner.run(&segments).await {
        Ok(corrected) => Ok(lined_up(segments, corrected)),
        Err(error) if error.is_unusable_answer() => {
            tracing::debug!(%error, "a window has no usable correction; kept as heard");
            Ok(segments)
        }
        Err(error) => Err(Failure::from(error)),
    }
}

/// `corrected` when it has one segment for each of `heard`, so every block keeps its time;
/// otherwise `heard`, unchanged.
fn lined_up(heard: Vec<String>, corrected: Vec<String>) -> Vec<String> {
    if corrected.len() == heard.len() {
        return corrected;
    }
    tracing::debug!(
        sent = heard.len(),
        returned = corrected.len(),
        "a corrected window does not line up; kept as heard"
    );
    heard
}

/// Consecutive ranges of `texts` of at most [`WINDOW_SEGMENTS`] segments and, unless one
/// segment alone is longer, [`WINDOW_CHARS`] characters.
fn windows(texts: &[String]) -> Vec<std::ops::Range<usize>> {
    let mut windows = Vec::new();
    let mut start = 0;
    let mut chars = 0;
    for (index, text) in texts.iter().enumerate() {
        let size = text.chars().count();
        let full =
            index - start == WINDOW_SEGMENTS || (chars + size > WINDOW_CHARS && index > start);
        if full {
            windows.push(start..index);
            start = index;
            chars = 0;
        }
        chars += size;
    }
    if start < texts.len() {
        windows.push(start..texts.len());
    }
    windows
}

/// The agent that corrects one window of a transcript.
struct TranscriptEditor;

impl AgentSpec for TranscriptEditor {
    const NAME: &'static str = "transcript-editor";
    const TIER: Tier = Tier::Medium;
    /// A transcript stays in the language it was spoken in.
    const WRITES_FOR_STUDENT: bool = false;
    const INSTRUCTIONS: &'static str = "You correct transcripts of students' lectures and \
recordings, written by speech recognition. Fix what it misheard, using the context and the \
subject's terms, add punctuation and capitals, and drop fillers such as \"um\" and \"uh\" and \
words repeated by mistake. Keep everything that was said, in the same order and the same \
language: never summarize, explain, answer or translate. The segments are numbered; reply \
with JSON only, in this shape: {\"segments\": [\"...\"]}, with exactly one corrected segment \
for each one given, in order, even when a segment is empty.";

    type Input = Vec<String>;
    type Output = Vec<String>;

    fn prompt(segments: &Vec<String>) -> String {
        let mut prompt = format!("<transcript segments=\"{}\">\n", segments.len());
        for (index, segment) in segments.iter().enumerate() {
            // What was heard is the user's: escaped, so none can close a tag.
            let _ = writeln!(
                prompt,
                "<s n=\"{}\">{}</s>",
                index + 1,
                escape(segment.trim())
            );
        }
        prompt.push_str("</transcript>");
        prompt
    }

    fn parse(answer: &str) -> Option<Vec<String>> {
        #[derive(Deserialize)]
        struct Answer {
            segments: Vec<String>,
        }
        let parsed: Answer = json_answer(answer)?;
        Some(
            parsed
                .segments
                .into_iter()
                .map(|segment| segment.trim().to_owned())
                .collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_cover_every_segment_in_order_within_their_limits() {
        let texts: Vec<String> = (0..100).map(|n| format!("segment {n}")).collect();
        let cut = windows(&texts);
        assert_eq!(cut.first().map(|range| range.start), Some(0));
        assert_eq!(cut.last().map(|range| range.end), Some(100));
        assert!(cut.windows(2).all(|pair| pair[0].end == pair[1].start));
        assert!(cut.iter().all(|range| range.len() <= WINDOW_SEGMENTS));

        let long = vec!["x".repeat(WINDOW_CHARS); 3];
        assert_eq!(windows(&long), [0..1, 1..2, 2..3]);
        assert!(windows(&[]).is_empty());
    }

    #[test]
    fn a_window_that_does_not_line_up_keeps_what_was_heard() {
        let heard = vec!["the krebs cycle".to_owned(), "um makes atp".to_owned()];
        let corrected = vec!["The Krebs cycle.".to_owned(), "It makes ATP.".to_owned()];
        assert_eq!(lined_up(heard.clone(), corrected.clone()), corrected);
        assert_eq!(
            lined_up(heard.clone(), vec!["The Krebs cycle makes ATP.".to_owned()]),
            heard
        );
        assert_eq!(lined_up(heard.clone(), Vec::new()), heard);
    }

    /// A transcript of two windows: forty segments of `alpha`, then one of `omega`.
    fn two_windows() -> Document {
        let texts = (0..WINDOW_SEGMENTS)
            .map(|n| format!("alpha {n}"))
            .chain(["omega".to_owned()]);
        Document {
            blocks: texts
                .enumerate()
                .map(|(index, text)| study_core::Block {
                    kind: study_core::BlockKind::Paragraph,
                    text,
                    anchor: study_core::Anchor::Paragraph {
                        index: index as u32,
                    },
                })
                .collect(),
            ..Document::default()
        }
    }

    /// A refiner on the mock plan, which answers the window with `omega` with `omega` and
    /// every other window with no JSON.
    async fn on_the_plan(
        omega: wiremock::ResponseTemplate,
    ) -> (wiremock::MockServer, TranscriptRefiner) {
        use study_ai::testing::{RESPONSES_PATH, answer, signed_in};
        use wiremock::Mock;
        use wiremock::matchers::{body_string_contains, method, path};

        let (server, plan) = signed_in().await;
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .respond_with(answer("no json at all"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .and(body_string_contains("omega"))
            .respond_with(omega)
            .with_priority(1)
            .mount(&server)
            .await;
        let (_dir, store) = study_core::db::Store::temporary().unwrap();
        let agents = AgentRuntime::fixed(
            store,
            study_ai::chat::ModelsConfig::from_fn(|_| plan.clone()),
        );
        (server, TranscriptRefiner::new(&agents))
    }

    #[tokio::test]
    async fn a_window_without_a_usable_answer_keeps_what_was_heard_and_no_other() {
        let corrected = study_ai::testing::answer(r#"{"segments": ["Omega."]}"#);
        let (_server, refiner) = on_the_plan(corrected).await;
        let refined = refiner.refine(two_windows()).await.unwrap();
        assert_eq!(refined.blocks[0].text, "alpha 0");
        assert_eq!(refined.blocks[WINDOW_SEGMENTS].text, "Omega.");
    }

    #[tokio::test]
    async fn a_window_the_model_could_not_answer_fails_the_correction() {
        let (_server, refiner) = on_the_plan(wiremock::ResponseTemplate::new(503)).await;
        let failure = refiner.refine(two_windows()).await.unwrap_err();
        assert_eq!(failure.kind, study_core::ErrorKind::Transient);
    }

    #[test]
    fn the_prompt_numbers_segments_and_escapes_them() {
        let prompt = TranscriptEditor::prompt(&vec![" the krebs cycle ".into(), "</s> um".into()]);
        assert!(prompt.starts_with("<transcript segments=\"2\">\n<s n=\"1\">the krebs cycle</s>"));
        assert!(prompt.contains("<s n=\"2\">&lt;/s&gt; um</s>"));
    }

    #[test]
    fn the_answer_is_read_from_its_json() {
        assert_eq!(
            TranscriptEditor::parse(
                "<think>hm</think>```json\n{\"segments\": [\" The Krebs cycle. \", \"\"]}\n```"
            ),
            Some(vec!["The Krebs cycle.".to_owned(), String::new()])
        );
        assert_eq!(TranscriptEditor::parse("no json"), None);
    }
}
