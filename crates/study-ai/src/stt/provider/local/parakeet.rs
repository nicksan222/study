//! NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0) on ONNX Runtime.
//!
//! Parakeet v3 transcribes 25 European languages, English and Italian among them, and tells
//! which one is spoken by itself, so a lecture needs no language setting and a language
//! switch mid-recording is still heard. It punctuates and capitalizes, times each sentence,
//! and runs many times faster than real time on an ordinary CPU, from a 670 MB download.

use std::path::Path;

use transcribe_rs::onnx::Quantization;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams, TimestampGranularity};

use crate::stt::error::Result;
use crate::stt::provider::Clip;
use crate::stt::transcript::{Segment, Transcript};
use crate::{ModelFile, ModelSpec};

pub(super) const NAME: &str = "parakeet-tdt-0.6b-v3";

/// The encoder attends to the whole clip, so memory grows with its square; 30 seconds keeps
/// one copy near 2 GB while giving each sentence plenty of context.
pub(super) const MAX_CLIP_SECS: f64 = 30.0;

/// Parakeet TDT 0.6B v3, INT8 ONNX export with the NeMo feature extractor.
pub const PARAKEET_TDT_V3_INT8: ModelSpec = ModelSpec {
    id: "parakeet-tdt-0.6b-v3-int8",
    repository: "istupakov/parakeet-tdt-0.6b-v3-onnx",
    revision: "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
    files: &[
        ModelFile {
            name: "vocab.txt",
            size: 93_939,
            sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
        },
        ModelFile {
            name: "nemo128.onnx",
            size: 139_764,
            sha256: "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f",
        },
        ModelFile {
            name: "decoder_joint-model.int8.onnx",
            size: 18_202_004,
            sha256: "eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70",
        },
        ModelFile {
            name: "encoder-model.int8.onnx",
            size: 652_183_999,
            sha256: "6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09",
        },
    ],
};

pub(super) type Model = ParakeetModel;

/// Loads one instance from `dir`. Takes a few seconds; call from a blocking context.
pub(super) fn load(dir: &Path) -> Result<Model> {
    ParakeetModel::load(dir, &Quantization::Int8)
        .map_err(|e| crate::Error::Model(e.to_string()).into())
}

/// Transcribes one clip, a segment per sentence; the model hears the language itself.
/// CPU-bound: call from a blocking context.
pub(super) fn transcribe(model: &mut Model, clip: Clip) -> Result<Transcript> {
    let duration_secs = clip.audio.duration_secs();
    let result = model
        .transcribe_with(
            clip.audio.samples(),
            &ParakeetParams {
                language: None,
                timestamp_granularity: Some(TimestampGranularity::Segment),
            },
        )
        .map_err(|e| crate::Error::Provider {
            provider: NAME,
            message: e.to_string(),
        })?;
    let text = result.text.trim().to_owned();
    let segments: Vec<Segment> = result
        .segments
        .unwrap_or_default()
        .into_iter()
        .filter(|segment| !segment.text.trim().is_empty())
        .map(|segment| Segment {
            start_secs: f64::from(segment.start).clamp(0.0, duration_secs),
            end_secs: f64::from(segment.end).clamp(0.0, duration_secs),
            text: segment.text.trim().to_owned(),
        })
        .collect();
    if segments.is_empty() {
        return Ok(Transcript::whole(text, duration_secs));
    }
    Ok(Transcript {
        text,
        segments,
        duration_secs,
    })
}
