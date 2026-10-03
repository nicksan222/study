//! Sifting: before material (or a practice question) is written, a fast model (the tiny
//! tier) reads every passage of its sources and drops what a student would never study:
//! small talk, greetings, room and microphone logistics, repetition, and transcription
//! noise. What is left is then fitted to what the writer is shown, so material covers the
//! whole of a long session rather than an even sample of it, garbage included, and no
//! question is written from a stretch of small talk.
//!
//! On unless the user switches it off ([`MaterialPreferences::sift`]). The passages go in
//! batches, several at once. Sifting is best effort: a batch the model
//! cannot sift is kept whole, and a batch it would empty keeps everything, so the writer
//! never has less to go on than without it.

use std::collections::{BTreeSet, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard};

use futures::{StreamExt as _, stream};
use serde::Deserialize;
use study_ai::agent::{AgentRuntime, AgentSpec, Runner, escape, json_answer, numbered_sources};
use study_ai::chat::Tier;
use study_core::Failure;
use study_core::processing::{Excerpt, MaterialPreferences};

/// Material shorter than this, in characters, is not worth a call: there is nothing to
/// make room for.
const WORTH_SIFTING: usize = 4_000;
/// Most characters of passages in one batch.
const BATCH_CHARS: usize = 24_000;
/// Most batches sifted at once.
const PARALLEL: usize = 4;
/// Most decisions remembered; past this the memory starts over.
const REMEMBERED: usize = 100_000;

/// Sifts passages on the tiny tier before material or a question is written from them.
/// It remembers each decision while the app runs (by the passage and what it is sifted
/// for), so work that reads the same material again and again, such as a practice writing
/// question after question, sifts each passage once.
#[derive(Clone)]
pub struct Sifter {
    agents: AgentRuntime,
    decided: Arc<Mutex<HashMap<u64, bool>>>,
}

impl Sifter {
    /// Sifts with the tiny tier's model of `agents`, remembering nothing yet.
    pub fn new(agents: &AgentRuntime) -> Self {
        Self {
            agents: agents.clone(),
            decided: Arc::default(),
        }
    }

    /// `excerpts` without the passages not worth studying for `title`, in their order; all of
    /// them when the user switched sifting off. Fails only when the tiny tier is not set up or the preferences
    /// cannot be read.
    pub async fn sift(&self, title: &str, excerpts: Vec<Excerpt>) -> Result<Vec<Excerpt>, Failure> {
        let total: usize = excerpts.iter().map(Excerpt::shown_chars).sum();
        if total < WORTH_SIFTING {
            return Ok(excerpts);
        }
        let preferences = self.agents.blocking(MaterialPreferences::load).await?;
        if !preferences.sift {
            return Ok(excerpts);
        }
        let keys: Vec<u64> = excerpts.iter().map(|excerpt| key(title, excerpt)).collect();
        // The memory is locked twice, never across the model call: two sifts of the same
        // passages at once each ask the model, which costs a call and loses nothing.
        let known: Vec<Option<bool>> = {
            let decided = self.memory();
            keys.iter().map(|key| decided.get(key).copied()).collect()
        };
        let unknown: Vec<Excerpt> = excerpts
            .iter()
            .zip(&known)
            .filter(|(_, known)| known.is_none())
            .map(|(excerpt, _)| excerpt.clone())
            .collect();
        let fresh = if unknown.is_empty() {
            Vec::new()
        } else {
            self.decide(title, &unknown).await?
        };
        let mut fresh = fresh.into_iter();
        let mut decided = self.memory();
        if decided.len() > REMEMBERED {
            decided.clear();
        }
        let before = excerpts.len();
        let sifted: Vec<Excerpt> = excerpts
            .into_iter()
            .zip(keys)
            .zip(known)
            .filter_map(|((excerpt, key), known)| {
                let keep = match known {
                    Some(keep) => keep,
                    // Only what the model decided is remembered; a batch it could not
                    // sift is kept, and asked about again next time.
                    None => match fresh.next().flatten() {
                        Some(keep) => {
                            decided.insert(key, keep);
                            keep
                        }
                        None => true,
                    },
                };
                keep.then_some(excerpt)
            })
            .collect();
        tracing::debug!(before, after = sifted.len(), "sifted passages");
        Ok(sifted)
    }

    /// The decisions remembered so far. A sift that panicked holding them leaves them
    /// whole, as each decision is inserted at once, so they are used as they are.
    fn memory(&self) -> MutexGuard<'_, HashMap<u64, bool>> {
        self.decided
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The model's decision on each of `excerpts`, in order: whether to keep it, or `None`
    /// throughout a batch it could not sift.
    async fn decide(
        &self,
        title: &str,
        excerpts: &[Excerpt],
    ) -> Result<Vec<Option<bool>>, Failure> {
        let runner = self.agents.required::<PassageSifter>().await?;
        let batches = batches(excerpts);
        // Built before streaming: a closure over borrowed batches would not be `Send`.
        let sifts: Vec<_> = batches
            .iter()
            .map(|batch| sift_batch(&runner, title, batch))
            .collect();
        let decided: Vec<Option<Vec<bool>>> =
            stream::iter(sifts).buffered(PARALLEL).collect().await;
        let mut decisions = Vec::with_capacity(excerpts.len());
        for (batch, decided) in batches.iter().zip(decided) {
            match decided {
                Some(keep) => decisions.extend(keep.into_iter().map(Some)),
                None => decisions.extend(std::iter::repeat_n(None, batch.len())),
            }
        }
        Ok(decisions)
    }
}

/// What a decision about `excerpt` is remembered by: the passage, where it is, and what
/// it was sifted for.
fn key(title: &str, excerpt: &Excerpt) -> u64 {
    let mut hasher = DefaultHasher::new();
    (title, excerpt.source_id, &excerpt.anchor, &excerpt.text).hash(&mut hasher);
    hasher.finish()
}

/// Which passages of `batch` to keep; `None` when the model fails or would keep none, and
/// then the batch is kept whole.
async fn sift_batch(
    runner: &Runner<PassageSifter>,
    title: &str,
    batch: &[Excerpt],
) -> Option<Vec<bool>> {
    let input = SiftInput {
        title: title.to_owned(),
        passages: batch.to_vec(),
    };
    match runner.run(&input).await {
        Ok(keep) => mask(&keep, batch.len()),
        Err(error) => {
            tracing::warn!(%error, "could not sift passages; keeping them");
            None
        }
    }
}

/// Which of `len` passages the numbers in `keep` name; `None` when they name none of them,
/// even when the model answered numbers past the batch, so a batch is never emptied.
fn mask(keep: &BTreeSet<u32>, len: usize) -> Option<Vec<bool>> {
    let mask: Vec<bool> = (1..=len as u32).map(|n| keep.contains(&n)).collect();
    mask.contains(&true).then_some(mask)
}

/// `excerpts` in runs of at most [`BATCH_CHARS`], in order; a passage longer than that is a
/// batch of its own.
fn batches(excerpts: &[Excerpt]) -> Vec<&[Excerpt]> {
    let mut batches = Vec::new();
    let (mut start, mut size) = (0, 0);
    for (index, excerpt) in excerpts.iter().enumerate() {
        let chars = excerpt.shown_chars();
        if index > start && size + chars > BATCH_CHARS {
            batches.push(&excerpts[start..index]);
            (start, size) = (index, 0);
        }
        size += chars;
    }
    if start < excerpts.len() {
        batches.push(&excerpts[start..]);
    }
    batches
}

/// One batch to sift, with what the material is about so the model can tell what is off it.
pub(super) struct SiftInput {
    title: String,
    passages: Vec<Excerpt>,
}

/// The agent that picks the passages worth studying.
pub(super) struct PassageSifter;

impl AgentSpec for PassageSifter {
    const NAME: &'static str = "passage-sifter";
    const TIER: Tier = Tier::Tiny;
    const INSTRUCTIONS: &'static str = "You sift a student's material before study \
material is made from it. The sources are numbered passages from their lectures, slides, \
recordings and notes, some transcribed by machine. Keep every passage with anything worth \
studying: explanations, definitions, facts, examples, steps, formulas, and what the teacher \
stresses or says will be examined. Drop a passage only when it is nothing but small talk, \
greetings, jokes, room or microphone logistics, housekeeping unrelated to the subject, a \
repetition of another passage, or transcription noise without meaning. When a passage mixes \
both, or you are unsure, keep it. Answer with JSON only: {\"keep\": [the numbers of the \
passages to keep]}.";
    const WRITES_FOR_STUDENT: bool = false;

    type Input = SiftInput;
    type Output = BTreeSet<u32>;

    fn prompt(input: &SiftInput) -> String {
        let mut prompt = format!("<title>{}</title>\n", escape(&input.title));
        prompt.push_str(&numbered_sources(&input.passages));
        prompt
    }

    fn parse(answer: &str) -> Option<BTreeSet<u32>> {
        #[derive(Deserialize)]
        struct Keep {
            keep: Vec<u32>,
        }
        json_answer::<Keep>(answer).map(|keep| keep.keep.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use study_ai::testing::{RESPONSES_PATH, answer};
    use study_core::db::Store;
    use study_core::processing::MAX_PASSAGE_CHARS;
    use study_core::{Anchor, SourceId};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, ResponseTemplate};

    fn passage(chars: usize) -> Excerpt {
        Excerpt {
            source_id: SourceId::new(1),
            source_name: "lecture.m4a".into(),
            anchor: Anchor::Time {
                start_ms: 0,
                end_ms: 1_000,
            },
            text: "x".repeat(chars),
        }
    }

    /// Passages `a`, `b` and `c`, each as long as a model is shown, together worth sifting
    /// and in one batch.
    fn worth_sifting() -> Vec<Excerpt> {
        let excerpts: Vec<Excerpt> = ['a', 'b', 'c']
            .into_iter()
            .map(|letter| Excerpt {
                text: letter.to_string().repeat(MAX_PASSAGE_CHARS),
                ..passage(0)
            })
            .collect();
        assert!(excerpts.iter().map(Excerpt::shown_chars).sum::<usize>() >= WORTH_SIFTING);
        excerpts
    }

    /// Each passage by its letter, for asserts short enough to read.
    fn letters(excerpts: &[Excerpt]) -> String {
        excerpts
            .iter()
            .filter_map(|excerpt| excerpt.text.chars().next())
            .collect()
    }

    /// A sifter on the mock plan, whose sifting answers come from the mocks mounted on the
    /// server, and the store it reads its preferences from.
    async fn on_the_plan() -> (wiremock::MockServer, tempfile::TempDir, Store, Sifter) {
        let (server, plan) = study_ai::testing::signed_in().await;
        let (dir, store) = Store::temporary().unwrap();
        let agents = AgentRuntime::fixed(
            store.clone(),
            study_ai::chat::ModelsConfig::from_fn(|_| plan.clone()),
        );
        (server, dir, store, Sifter::new(&agents))
    }

    /// Answers every sift with `response`, `calls` times in all.
    async fn sifts(server: &wiremock::MockServer, response: ResponseTemplate, calls: u64) {
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .respond_with(response)
            .expect(calls)
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn the_same_passages_are_sifted_once() {
        let (server, _dir, _store, sifter) = on_the_plan().await;
        sifts(&server, answer(r#"{"keep": [1]}"#), 1).await;
        for _ in 0..2 {
            let sifted = sifter.sift("Cells", worth_sifting()).await.unwrap();
            assert_eq!(letters(&sifted), "a");
        }
    }

    #[tokio::test]
    async fn a_batch_that_could_not_be_sifted_is_kept_and_asked_about_again() {
        let (server, _dir, _store, sifter) = on_the_plan().await;
        Mock::given(method("POST"))
            .and(path(RESPONSES_PATH))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .with_priority(1)
            .expect(1)
            .mount(&server)
            .await;
        sifts(&server, answer(r#"{"keep": [1]}"#), 1).await;
        let kept = sifter.sift("Cells", worth_sifting()).await.unwrap();
        assert_eq!(letters(&kept), "abc");
        let sifted = sifter.sift("Cells", worth_sifting()).await.unwrap();
        assert_eq!(letters(&sifted), "a");
    }

    #[tokio::test]
    async fn sifting_switched_off_keeps_every_passage_without_a_call() {
        let (server, _dir, store, sifter) = on_the_plan().await;
        sifts(&server, answer(r#"{"keep": [1]}"#), 0).await;
        store
            .run(|database| MaterialPreferences { sift: false }.save(database))
            .await
            .unwrap();
        let kept = sifter.sift("Cells", worth_sifting()).await.unwrap();
        assert_eq!(letters(&kept), "abc");
    }

    #[test]
    fn batches_cover_every_passage_in_order_within_the_size() {
        let excerpts: Vec<Excerpt> = (0..100).map(|n| passage(200 + n * 13)).collect();
        let batches = batches(&excerpts);
        assert!(batches.len() > 1);
        assert_eq!(batches.concat(), excerpts);
        for batch in &batches {
            assert!(batch.iter().map(Excerpt::shown_chars).sum::<usize>() <= BATCH_CHARS);
        }
        assert!(super::batches(&[]).is_empty());
    }

    #[test]
    fn numbers_that_name_no_passage_keep_the_batch_whole() {
        let mask = |keep: &[u32]| mask(&keep.iter().copied().collect(), 3);
        assert_eq!(mask(&[2, 9]), Some(vec![false, true, false]));
        assert_eq!(mask(&[0]), None);
        assert_eq!(mask(&[4, 5]), None);
        assert_eq!(mask(&[]), None);
    }

    #[test]
    fn the_answer_is_the_passages_to_keep() {
        let keep = PassageSifter::parse("```json\n{\"keep\": [3, 1, 3]}\n```").unwrap();
        assert_eq!(keep.into_iter().collect::<Vec<_>>(), [1, 3]);
        assert_eq!(PassageSifter::parse("all of them"), None);
    }

    #[test]
    fn the_prompt_names_the_title_and_numbers_the_passages() {
        let input = SiftInput {
            title: "Mitosis".into(),
            passages: vec![passage(3)],
        };
        let prompt = PassageSifter::prompt(&input);
        assert!(prompt.starts_with("<title>Mitosis</title>\n"));
        assert!(prompt.contains("<source n=\"1\""), "{prompt}");
    }
}
