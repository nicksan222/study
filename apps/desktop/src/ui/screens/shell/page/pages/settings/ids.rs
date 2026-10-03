//! Element ids of Settings, by section. Ids that add an enum's value count from their base.

/// Base of the sidebar's sections; each adds its `SettingsSection`.
pub const SECTION: usize = 100;
/// Base of the language cards; each adds its `Language`.
pub const LANGUAGE: usize = 200;
/// Base of the appearance cards; each adds its `Appearance`.
pub const APPEARANCE: usize = 300;
pub const ZOOM_OUT: usize = 320;
pub const RESET_ZOOM: usize = 321;
pub const ZOOM_IN: usize = 322;

pub const TRANSCRIPTION_SAVE: usize = 1301;
pub const TRANSCRIPTION_DOWNLOAD: usize = 1303;
pub const TRANSCRIPTION_RETRY: usize = 1304;

pub const SYSTEM_MEASURE_AGAIN: usize = 1321;
pub const SYSTEM_DOWNLOAD: usize = 1322;

pub const LLM_SAVE: usize = 1501;
pub const LLM_TEST: usize = 1502;
pub const LLM_RETRY: usize = 1503;
pub const LLM_SIGN_IN: usize = 1505;
pub const LLM_SIGN_OUT: usize = 1506;
pub const LLM_MANAGE_USAGE: usize = 1507;
/// Base of the tiers' model pickers; each adds the tier's place in `Tier::ALL`.
pub const LLM_MODEL: usize = 1510;

/// Base of the AI overview's card actions; each adds the card's place.
pub const OVERVIEW_ACTION: usize = 1600;

/// Tries loading the processing switches again after a failure.
pub const PROCESSING_RETRY: usize = 7900;
pub const PROCESSING_SIFT: usize = 7901;
pub const NEW_CARDS: usize = 7902;
/// Base of the rows that open each kind of file's switches; each adds the kind's place in
/// `SourceKind::ALL`.
pub const PROCESSING_KIND: usize = 7910;
/// Base of the processing switches; each adds `PROCESSING_STRIDE` times the kind of
/// source's place in `SourceKind::ALL`, plus the switch's place in its card. The range ends
/// at `PROCESSING_END`, clear of every other page's ids.
pub const PROCESSING_SWITCH: usize = 8000;
pub const PROCESSING_STRIDE: usize = 64;
pub const PROCESSING_END: usize = 8999;
/// The typed number of transcription model copies.
pub const MODEL_COPIES: &str = "model-copies";

/// Signed application update actions.
pub const UPDATE_CHECK: usize = 1700;
pub const UPDATE_INSTALL: usize = 1701;
