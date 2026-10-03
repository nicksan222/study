//! The real model. Downloads about 135 MB the first time, into the app's model cache:
//! `cargo test -p study-ai --test embed_model -- --ignored`.

use study_ai::embed::{Embedder, MULTILINGUAL_E5_SMALL, OnnxEmbedder, Role};
use study_core::Result;

fn similarity(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "downloads the model"]
async fn related_text_is_closer_than_unrelated_text_across_languages() -> Result<()> {
    let dir = MULTILINGUAL_E5_SMALL.dir(None)?;
    MULTILINGUAL_E5_SMALL.download(&dir).await?;
    let embedder = tokio::task::spawn_blocking(move || OnnxEmbedder::load(&dir)).await??;

    let passages = [
        "Plants turn sunlight, water, and carbon dioxide into sugar and oxygen.",
        "The French Revolution began in 1789 with the storming of the Bastille.",
        "La fotosintesi clorofilliana trasforma la luce del sole in energia chimica.",
    ]
    .map(str::to_owned);
    let passages = embedder.embed(&passages, Role::Passage)?;
    for query in [
        "photosynthesis",
        "come le piante producono energia dalla luce",
    ] {
        let query = &embedder.embed(&[query.to_owned()], Role::Query)?[0];
        let scores: Vec<f32> = passages.iter().map(|p| similarity(query, p)).collect();
        assert!(
            scores[0] > scores[1] && scores[2] > scores[1],
            "unexpected similarities {scores:?}"
        );
    }
    assert_eq!(passages[0].len(), 384);
    assert!((similarity(&passages[0], &passages[0]) - 1.0).abs() < 1e-4);
    Ok(())
}
