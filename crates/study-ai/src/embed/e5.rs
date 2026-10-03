//! Multilingual E5 small on ONNX Runtime, in-process and on the CPU: the spec to download
//! and [`OnnxEmbedder`].

use std::path::Path;
use std::sync::Mutex;

use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use study_core::{Context as _, Result, err};
use tokenizers::{Tokenizer, TruncationParams};

use super::{Embedder, Role};
use crate::{ModelFile, ModelSpec};

/// Multilingual E5 small (MIT), INT8 ONNX export: 384 dimensions, 100 languages.
pub const MULTILINGUAL_E5_SMALL: ModelSpec = ModelSpec {
    id: "multilingual-e5-small-int8",
    repository: "Xenova/multilingual-e5-small",
    revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    files: &[
        ModelFile {
            name: "tokenizer.json",
            size: 17_082_730,
            sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
        },
        ModelFile {
            name: "onnx/model_quantized.onnx",
            size: 118_308_185,
            sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
        },
    ],
};

/// Tokens the model reads per text; longer chunks are cut.
const MAX_TOKENS: usize = 512;

/// [`MULTILINGUAL_E5_SMALL`] loaded on ONNX Runtime; one session, shared behind a lock.
pub struct OnnxEmbedder {
    tokenizer: Tokenizer,
    session: Mutex<Session>,
    /// Whether the export expects `token_type_ids` as well.
    token_types: bool,
    pad_id: u32,
}

impl OnnxEmbedder {
    /// Loads the model from `dir`, where [`MULTILINGUAL_E5_SMALL`] was downloaded. Takes a
    /// moment; call from a blocking context.
    pub fn load(dir: &Path) -> Result<Self> {
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json"))
            .map_err(|error| err!("cannot read the search tokenizer: {error}"))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: MAX_TOKENS,
                ..TruncationParams::default()
            }))
            .map_err(|error| err!("cannot configure the search tokenizer: {error}"))?;
        // At most four threads, so the rest of the cores stay free for other work.
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get().min(4));
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(ort::Error::<()>::from)?
            .with_intra_threads(threads)
            .map_err(ort::Error::<()>::from)?
            .commit_from_file(dir.join("onnx/model_quantized.onnx"))
            .context("cannot load the search model")?;
        let token_types = session
            .inputs()
            .iter()
            .any(|input| input.name() == "token_type_ids");
        // 1 is `<pad>` in the XLM-RoBERTa vocabulary E5 uses.
        let pad_id = tokenizer.token_to_id("<pad>").unwrap_or(1);
        Ok(Self {
            tokenizer,
            session: Mutex::new(session),
            token_types,
            pad_id,
        })
    }
}

impl Embedder for OnnxEmbedder {
    fn model_id(&self) -> &str {
        MULTILINGUAL_E5_SMALL.id
    }

    fn embed(&self, texts: &[String], role: Role) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let prefix = match role {
            Role::Query => "query: ",
            Role::Passage => "passage: ",
        };
        let inputs: Vec<String> = texts.iter().map(|text| format!("{prefix}{text}")).collect();
        let encodings = self
            .tokenizer
            .encode_batch(inputs, true)
            .map_err(|error| err!("cannot tokenize for search: {error}"))?;

        // Pad to the longest text; the attention mask keeps padding out of the result.
        let batch = encodings.len();
        let width = encodings
            .iter()
            .map(|e| e.get_ids().len())
            .max()
            .unwrap_or(0);
        let mut ids = vec![i64::from(self.pad_id); batch * width];
        let mut mask = vec![0_i64; batch * width];
        for (row, encoding) in encodings.iter().enumerate() {
            for (column, &id) in encoding.get_ids().iter().enumerate() {
                ids[row * width + column] = i64::from(id);
                mask[row * width + column] = 1;
            }
        }
        let shape = [batch, width];
        let mut named = ort::inputs![
            "input_ids" => Tensor::from_array((shape, ids))?,
            "attention_mask" => Tensor::from_array((shape, mask.clone()))?,
        ];
        if self.token_types {
            named.push((
                "token_type_ids".into(),
                Tensor::from_array((shape, vec![0_i64; batch * width]))?.into(),
            ));
        }

        let mut session = self
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let outputs = session.run(named)?;
        let (dims, hidden) = outputs[0].try_extract_tensor::<f32>()?;
        let size = *dims
            .last()
            .context("the search model returned no dimensions")? as usize;
        Ok(mean_pool(hidden, &mask, batch, width, size))
    }
}

/// One vector per row of a `batch`×`width` token grid: the mean of the `size`-long token
/// vectors in `hidden` that `mask` keeps, at unit length. Scaling does not change the
/// direction, so the sum is normalized directly.
fn mean_pool(
    hidden: &[f32],
    mask: &[i64],
    batch: usize,
    width: usize,
    size: usize,
) -> Vec<Vec<f32>> {
    (0..batch)
        .map(|row| {
            let mut pooled = vec![0.0_f32; size];
            for column in (0..width).filter(|column| mask[row * width + column] == 1) {
                let start = (row * width + column) * size;
                for (sum, value) in pooled.iter_mut().zip(&hidden[start..start + size]) {
                    *sum += value;
                }
            }
            let norm = pooled.iter().map(|v| v * v).sum::<f32>().sqrt();
            if norm > 0.0 {
                pooled.iter_mut().for_each(|v| *v /= norm);
            }
            pooled
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pooling_averages_only_masked_tokens_to_unit_length() {
        // Two rows of two tokens with 2-dimensional vectors; the second row's last token is
        // padding and must not count.
        let hidden = [3.0, 0.0, 0.0, 4.0, 1.0, 1.0, 100.0, 100.0];
        let mask = [1, 1, 1, 0];
        let pooled = mean_pool(&hidden, &mask, 2, 2, 2);
        assert_eq!(pooled[0], [0.6, 0.8]);
        let half = std::f32::consts::FRAC_1_SQRT_2;
        assert!(
            pooled[1].iter().all(|v| (v - half).abs() < 1e-6),
            "{pooled:?}"
        );
    }
}
