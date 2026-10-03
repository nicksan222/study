//! Study's own decoder: Symphonia probes the container and decodes the default audio track.
//! Opus, which Symphonia can demux but not decode, goes to `opus-decoder`.
//!
//! To add a codec Symphonia can demux but not decode: add a [`Decoder`] variant, route its
//! codec ID to it in `Decoder::new`, and fill in the exhaustive matches in `decode`, `spec`
//! and `trim_start`. For a container Symphonia can't demux at all, add its FFmpeg demuxer
//! name to `DEMUXERS` in `ffmpeg.rs`, or enable the Symphonia feature that adds it.

use symphonia::core::codecs::audio::well_known::CODEC_ID_OPUS;
use symphonia::core::codecs::audio::{AudioCodecParameters, AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::packet::Packet;

use crate::error::{Error, Result};

/// Opus always decodes at 48 kHz, whatever rate the recording was made at.
const OPUS_RATE: u32 = 48_000;
/// The longest Opus packet holds 120 ms.
const OPUS_MAX_FRAMES: usize = 5_760;

/// The default audio track as it was recorded, before downmixing and resampling.
pub(super) struct Decoded {
    /// Interleaved samples, one per channel per frame.
    pub samples: Vec<f32>,
    pub rate: u32,
    pub channels: u16,
}

/// Why Study's own decoder did not read a recording.
pub(super) enum Unread {
    /// It does not know the format or the codec, so FFmpeg may; the text says why.
    Unknown(String),
    /// It knows the format, but the recording is damaged or holds nothing.
    Failed(Error),
}

impl From<Error> for Unread {
    fn from(error: Error) -> Self {
        Self::Failed(error)
    }
}

/// Decodes the default audio track. `extension` is a hint for the probe. A format or codec
/// it cannot read is [`Unread::Unknown`], which the caller answers by trying FFmpeg; a
/// failure once decoding has started is the recording's own.
pub(super) fn decode(
    source: Box<dyn MediaSource + '_>,
    extension: Option<&str>,
) -> Result<Decoded, Unread> {
    let stream = MediaSourceStream::new(source, Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = extension {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            stream,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| Unread::Unknown(e.to_string()))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| Unread::Unknown("no audio track".into()))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .ok_or_else(|| Unread::Unknown("track has no audio parameters".into()))?;
    let mut decoder = Decoder::new(params).map_err(Unread::Unknown)?;

    let mut samples = Vec::new();
    let mut dropped = 0;
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            // Some demuxers end a stream, or a truncated recording, this way: keep what
            // decoded.
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(e) => return Err(Error::Decode(e.to_string()).into()),
        };
        if packet.track_id == track_id && !decoder.decode(&packet, &mut samples)? {
            dropped += 1;
        }
    }
    if dropped > 0 {
        tracing::warn!(dropped, "skipped corrupt packets");
    }
    let (rate, channels) = decoder.spec().ok_or(Error::EmptyAudio)?;
    decoder.trim_start(&mut samples);
    let channels =
        u16::try_from(channels).map_err(|_| Error::Decode("too many channels".into()))?;
    Ok(Decoded {
        samples,
        rate,
        channels,
    })
}

/// One track's codec: whatever Symphonia decodes, or Opus.
enum Decoder {
    Symphonia {
        decoder: Box<dyn AudioDecoder>,
        spec: Option<(u32, usize)>,
        /// Reused buffer each packet is copied into, interleaved.
        scratch: Vec<f32>,
    },
    Opus {
        decoder: Box<opus_decoder::OpusDecoder>,
        channels: usize,
        /// Frames at the start that only prime the decoder (the Opus "pre-skip").
        pre_skip: usize,
        /// Whether any packet has decoded yet.
        decoded: bool,
        /// Reused output buffer, big enough for the longest packet.
        pcm: Vec<f32>,
    },
}

impl Decoder {
    /// Picks the decoder for the track's codec: the one dispatch point for codecs. The
    /// error says why none can decode it.
    fn new(params: &AudioCodecParameters) -> Result<Self, String> {
        match params.codec {
            CODEC_ID_OPUS => Self::opus(params),
            // Everything else is Symphonia's; one it lacks fails here and falls to FFmpeg.
            _ => Self::symphonia(params),
        }
    }

    fn symphonia(params: &AudioCodecParameters) -> Result<Self, String> {
        let decoder = symphonia::default::get_codecs()
            .make_audio_decoder(params, &AudioDecoderOptions::default())
            .map_err(|e| e.to_string())?;
        Ok(Self::Symphonia {
            decoder,
            spec: None,
            scratch: Vec::new(),
        })
    }

    /// Opus streams carry an `OpusHead` with the channel count and pre-skip; without one,
    /// assume the common case of a mono voice recording.
    fn opus(params: &AudioCodecParameters) -> Result<Self, String> {
        // `OpusHead`: the magic, a version byte, the channel count at 9 and the pre-skip at
        // 10–11, little-endian.
        let head = params
            .extra_data
            .as_deref()
            .filter(|head| head.len() >= 12 && head.starts_with(b"OpusHead"));
        let channels = head
            .map(|head| usize::from(head[9]))
            .or_else(|| params.channels.as_ref().map(|channels| channels.count()))
            .unwrap_or(1);
        if !(1..=2).contains(&channels) {
            return Err(format!("Opus with {channels} channels is not supported"));
        }
        let pre_skip = head.map_or(0, |head| {
            usize::from(u16::from_le_bytes([head[10], head[11]]))
        });
        let decoder = Box::new(
            opus_decoder::OpusDecoder::new(OPUS_RATE, channels).map_err(|e| e.to_string())?,
        );
        Ok(Self::Opus {
            decoder,
            channels,
            pre_skip,
            decoded: false,
            pcm: vec![0.0; OPUS_MAX_FRAMES * channels],
        })
    }

    /// Appends one packet's interleaved samples, or returns `false` for a corrupt packet,
    /// which loses a few milliseconds; the rest of the recording is kept.
    fn decode(&mut self, packet: &Packet, samples: &mut Vec<f32>) -> Result<bool> {
        match self {
            Self::Symphonia {
                decoder,
                spec,
                scratch,
            } => match decoder.decode(packet) {
                Ok(buffer) => {
                    let buffer_spec = buffer.spec();
                    spec.get_or_insert((buffer_spec.rate(), buffer_spec.channels().count()));
                    scratch.resize(buffer.samples_interleaved(), 0.0);
                    buffer.copy_to_slice_interleaved(scratch.as_mut_slice());
                    samples.extend_from_slice(scratch);
                    Ok(true)
                }
                Err(SymphoniaError::DecodeError(_)) => Ok(false),
                Err(e) => Err(Error::Decode(e.to_string())),
            },
            Self::Opus {
                decoder,
                channels,
                decoded,
                pcm,
                ..
            } => {
                let Ok(frames) = decoder.decode_float(&packet.data, pcm, false) else {
                    return Ok(false);
                };
                *decoded = true;
                samples.extend_from_slice(&pcm[..frames * *channels]);
                Ok(true)
            }
        }
    }

    /// Sample rate and channels, once anything has been decoded.
    fn spec(&self) -> Option<(u32, usize)> {
        match self {
            Self::Symphonia { spec, .. } => *spec,
            Self::Opus {
                decoded, channels, ..
            } => decoded.then_some((OPUS_RATE, *channels)),
        }
    }

    /// Drops the priming samples a codec asks to discard.
    fn trim_start(&self, samples: &mut Vec<f32>) {
        match self {
            // Symphonia's output is kept as decoded.
            Self::Symphonia { .. } => {}
            Self::Opus {
                pre_skip, channels, ..
            } => {
                samples.drain(..(pre_skip * channels).min(samples.len()));
            }
        }
    }
}
