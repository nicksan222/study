//! Recording from the microphone into the database.
//!
//! A thread owns the microphone stream and saves what it heard about once a second, so the
//! database always holds the recording up to the last second. If the app stops for any
//! reason, the recording is still there to resume or post.

use super::downsample::Downsampler;
use cpal::traits::{DeviceTrait as _, HostTrait as _, StreamTrait as _};
use cpal::{ErrorKind, FromSample, SampleFormat, SizedSample, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use study_app::App;
use study_app::views::{MAX_RECORDING_SAMPLES, RECORDING_SAMPLE_RATE, Recording};
use study_core::{Context as _, RecordingId, Result, SessionId, err};

/// How often heard audio is saved; at most this much is lost if the app stops abruptly.
const SAVE_INTERVAL: Duration = Duration::from_secs(1);

/// Why a recording ended.
#[derive(Debug)]
pub enum Ended {
    /// It was asked to stop.
    Stopped,
    /// It reached the longest recording the Library can hold.
    Full,
    /// The microphone or the database failed. Everything saved before that is kept.
    Failed(study_core::Error),
}

/// A recording in progress. Dropping it stops recording without waiting.
pub struct Recorder {
    recording_id: RecordingId,
    session_id: SessionId,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<Ended>>,
}

/// What the recorder thread and its `Recorder` both see.
struct Shared {
    stop: AtomicBool,
    /// Samples saved, including those saved before this recorder started.
    saved: AtomicU64,
    /// Peak of the latest audio heard, as `f32` bits.
    level: AtomicU32,
}

impl Shared {
    /// Before anything is heard, after the `saved` samples already in the recording.
    fn new(saved: u64) -> Self {
        Self {
            stop: AtomicBool::new(false),
            saved: AtomicU64::new(saved),
            level: AtomicU32::new(0),
        }
    }
}

impl Recorder {
    /// Opens the default microphone and saves what it hears after the audio `recording`
    /// already has. Blocks until the microphone is open, so call it off the UI thread.
    pub fn start(app: App, recording: &Recording) -> Result<Self> {
        let shared = Arc::new(Shared::new(recording.samples));
        let (ready, opened) = mpsc::sync_channel(1);
        let recording_id = recording.id;
        let thread = std::thread::Builder::new()
            .name("study-recorder".into())
            .spawn({
                let shared = shared.clone();
                move || record(app, recording_id, &shared, ready)
            })
            .context("cannot start the recorder")?;
        match opened.recv() {
            Ok(Ok(())) => Ok(Self {
                recording_id,
                session_id: recording.session_id,
                shared,
                thread: Some(thread),
            }),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(err!("the recorder stopped before the microphone opened")),
        }
    }

    /// Continues a saved recording after its last saved audio, like [`start`](Self::start).
    pub fn resume(app: App, recording_id: RecordingId) -> Result<Self> {
        let recording = app
            .recording(recording_id)?
            .with_context(|| format!("recording {recording_id} is gone"))?;
        Self::start(app, &recording)
    }

    /// The recording being made.
    pub fn recording_id(&self) -> RecordingId {
        self.recording_id
    }

    /// The session the recording belongs to.
    pub fn session_id(&self) -> SessionId {
        self.session_id
    }

    /// Whole seconds saved so far.
    pub fn seconds(&self) -> u64 {
        self.shared.saved.load(Ordering::Relaxed) / u64::from(RECORDING_SAMPLE_RATE)
    }

    /// How loud the microphone is right now, from 0 to 1.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.shared.level.load(Ordering::Relaxed)).clamp(0., 1.)
    }

    /// Whether it ended by itself, because it was full or something failed.
    pub fn has_ended(&self) -> bool {
        self.thread.as_ref().is_none_or(JoinHandle::is_finished)
    }

    /// Stops listening, saves the audio heard so far, and says why the recording ended.
    /// Blocks until everything is saved, so call it off the UI thread.
    pub fn stop(mut self) -> Ended {
        self.shared.stop.store(true, Ordering::Relaxed);
        match self.thread.take().map(JoinHandle::join) {
            Some(Ok(ended)) => ended,
            Some(Err(_)) => Ended::Failed(err!("the recorder crashed")),
            None => Ended::Stopped,
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::Relaxed);
    }
}

/// The recorder thread: opens the microphone, reports whether that worked on `ready`, then
/// saves what it hears until told to stop.
fn record(
    app: App,
    recording_id: RecordingId,
    shared: &Shared,
    ready: mpsc::SyncSender<Result<()>>,
) -> Ended {
    let (heard, audio) = mpsc::channel();
    let failure = Arc::new(AtomicBool::new(false));
    let opened = open_microphone(heard, failure.clone()).and_then(|(stream, rate)| {
        stream.play().context("cannot start the microphone")?;
        Ok((stream, rate))
    });
    let (stream, rate) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            let _ = ready.send(Err(error));
            return Ended::Stopped;
        }
    };
    let _ = ready.send(Ok(()));

    let mut downsampler = Downsampler::new(rate, RECORDING_SAMPLE_RATE);
    let mut pending = Vec::with_capacity(RECORDING_SAMPLE_RATE as usize * 2);
    let mut last_save = Instant::now();
    let mut stream = Some(stream);
    loop {
        let stopping = shared.stop.load(Ordering::Relaxed);
        if stopping {
            // Stop the callback first so everything it sent is already queued.
            stream.take();
        }
        let wait = if stopping {
            Duration::ZERO
        } else {
            Duration::from_millis(100)
        };
        let mut disconnected = false;
        match audio.recv_timeout(wait) {
            Ok(block) => {
                take(&block, &mut downsampler, &mut pending, shared);
                for block in audio.try_iter() {
                    take(&block, &mut downsampler, &mut pending, shared);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => disconnected = true,
        }
        let failed = failure.load(Ordering::Relaxed) || (disconnected && !stopping);
        if stopping || failed || last_save.elapsed() >= SAVE_INTERVAL {
            match save(&app, recording_id, shared, &mut pending) {
                Ok(false) => {}
                Ok(true) => return Ended::Full,
                Err(error) => return Ended::Failed(error),
            }
            last_save = Instant::now();
            if failed {
                return Ended::Failed(err!("the microphone stopped working"));
            }
            if stopping {
                return Ended::Stopped;
            }
        }
    }
}

/// Appends `pending` to the recording after the audio already saved, as much as the longest
/// recording allows, and empties it. Returns whether the recording is now full.
fn save(
    app: &App,
    recording_id: RecordingId,
    shared: &Shared,
    pending: &mut Vec<i16>,
) -> Result<bool> {
    let saved = shared.saved.load(Ordering::Relaxed);
    let room = MAX_RECORDING_SAMPLES.saturating_sub(saved) as usize;
    let full = pending.len() >= room;
    pending.truncate(room);
    app.append_recording(recording_id, pending)?;
    shared
        .saved
        .store(saved + pending.len() as u64, Ordering::Relaxed);
    pending.clear();
    Ok(full)
}

/// Converts a block the microphone sent and notes how loud it was.
fn take(block: &[f32], downsampler: &mut Downsampler, pending: &mut Vec<i16>, shared: &Shared) {
    let peak = block
        .iter()
        .fold(0f32, |peak, sample| peak.max(sample.abs()));
    shared.level.store(peak.to_bits(), Ordering::Relaxed);
    downsampler.push(block, pending);
}

/// Opens the default input device, preferring a 16 kHz format so nothing needs converting.
/// Sends mono blocks to `heard` and returns the stream with its sample rate.
fn open_microphone(
    heard: mpsc::Sender<Vec<f32>>,
    failure: Arc<AtomicBool>,
) -> Result<(cpal::Stream, u32)> {
    let device = cpal::default_host()
        .default_input_device()
        .context("no microphone is available")?;
    let usable = |format: SampleFormat| {
        matches!(
            format,
            SampleFormat::F32 | SampleFormat::I16 | SampleFormat::I32 | SampleFormat::U16
        )
    };
    let preferred = device.supported_input_configs().ok().and_then(|configs| {
        configs
            .filter(|range| usable(range.sample_format()))
            .filter_map(|range| range.try_with_sample_rate(RECORDING_SAMPLE_RATE))
            // Mono where offered: every frame is mixed down to one channel anyway.
            .min_by_key(|config| config.channels())
    });
    let config = match preferred {
        Some(config) => config,
        None => device
            .default_input_config()
            .context("cannot read the microphone's format")?,
    };
    let channels = usize::from(config.channels()).max(1);
    let rate = config.sample_rate();
    let format = config.sample_format();
    let config: StreamConfig = config.into();
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &config, channels, heard, failure),
        SampleFormat::I16 => build::<i16>(&device, &config, channels, heard, failure),
        SampleFormat::I32 => build::<i32>(&device, &config, channels, heard, failure),
        SampleFormat::U16 => build::<u16>(&device, &config, channels, heard, failure),
        other => return Err(err!("unsupported microphone format {other}")),
    }?;
    Ok((stream, rate))
}

/// The input stream for a device whose samples are `T`, mixing each frame down to mono.
fn build<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: usize,
    heard: mpsc::Sender<Vec<f32>>,
    failure: Arc<AtomicBool>,
) -> Result<cpal::Stream>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &_| {
                let mono = data
                    .chunks(channels)
                    .map(|frame| {
                        frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / frame.len() as f32
                    })
                    .collect();
                let _ = heard.send(mono);
            },
            move |error: cpal::Error| match error.kind() {
                // Glitches and rerouting keep the stream alive.
                ErrorKind::DeviceChanged | ErrorKind::Xrun | ErrorKind::RealtimeDenied => {}
                _ => {
                    tracing::error!(error = %error, "microphone stream failed");
                    failure.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .context("cannot open the microphone")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::TempApp;

    #[test]
    fn heard_audio_is_saved_after_what_was_saved_before() -> Result<()> {
        let app = TempApp::new();
        let project = app.create_project("Biology")?;
        let session = app.create_session(project.id, "Lecture")?;
        let recording = app.create_recording(session.id)?;
        let shared = Shared::new(0);

        let mut pending = vec![1; 1_600];
        assert!(!save(&app, recording.id, &shared, &mut pending)?);
        assert!(pending.is_empty());
        let mut pending = vec![2; 400];
        assert!(!save(&app, recording.id, &shared, &mut pending)?);

        assert_eq!(shared.saved.load(Ordering::Relaxed), 2_000);
        assert_eq!(app.recording(recording.id)?.unwrap().samples, 2_000);
        Ok(())
    }

    #[test]
    fn a_full_recording_keeps_only_what_fits() -> Result<()> {
        let app = TempApp::new();
        let project = app.create_project("Biology")?;
        let session = app.create_session(project.id, "Lecture")?;
        let recording = app.create_recording(session.id)?;
        // As if all but ten samples had been saved already, before this recorder started.
        let shared = Shared::new(MAX_RECORDING_SAMPLES - 10);

        let mut pending = vec![1; 25];
        assert!(save(&app, recording.id, &shared, &mut pending)?);
        assert!(pending.is_empty());
        assert_eq!(shared.saved.load(Ordering::Relaxed), MAX_RECORDING_SAMPLES);
        assert_eq!(app.recording(recording.id)?.unwrap().samples, 10);
        Ok(())
    }

    /// Needs a real microphone: `cargo test -p study microphone -- --ignored`.
    #[test]
    #[ignore = "records from this machine's microphone"]
    fn the_microphone_is_saved_every_second_and_on_stop() -> Result<()> {
        let app = TempApp::new();
        let project = app.create_project("Biology")?;
        let session = app.create_session(project.id, "Lecture")?;
        let recording = app.create_recording(session.id)?;

        let recorder = Recorder::start(app.clone(), &recording)?;
        std::thread::sleep(Duration::from_millis(2_500));
        // Saved while still recording, as a crash would find it.
        let saved = app.recording(recording.id)?.unwrap().samples;
        assert!(
            saved >= 16_000,
            "only {saved} samples saved while recording"
        );
        assert!(matches!(recorder.stop(), Ended::Stopped));

        let stored = app.recording(recording.id)?.unwrap();
        assert!(stored.samples > saved);
        assert!(
            (38_000..=44_000).contains(&stored.samples),
            "{}",
            stored.samples
        );

        // Resuming continues after the audio already saved.
        let recorder = Recorder::start(app.clone(), &stored)?;
        std::thread::sleep(Duration::from_millis(1_200));
        assert!(matches!(recorder.stop(), Ended::Stopped));
        assert!(app.recording(recording.id)?.unwrap().samples > stored.samples + 16_000);
        Ok(())
    }
}
