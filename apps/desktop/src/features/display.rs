//! The display zoom: its steps, and the shortcuts that move through them. GPUI applies the
//! factor; this only decides it.

use gpui_kit::Keystroke;

/// Every step, in percent. They lie within `study_ui::ZOOM_RANGE`, ending on its bounds.
const LEVELS: [u16; 9] = [75, 80, 90, 100, 110, 125, 150, 175, 200];
/// The place of 100% in `LEVELS`.
const UNZOOMED: usize = 3;

/// One of the zoom steps; 100% by default.
#[derive(Clone, Copy, Debug)]
pub struct ZoomLevel {
    index: usize,
}

impl Default for ZoomLevel {
    fn default() -> Self {
        Self { index: UNZOOMED }
    }
}

impl ZoomLevel {
    /// The step of a saved `percent`, or 100% when it is no step.
    pub fn from_percent(percent: u16) -> Self {
        LEVELS
            .iter()
            .position(|level| *level == percent)
            .map(|index| Self { index })
            .unwrap_or_default()
    }

    /// The step in percent, as it is saved and shown.
    pub fn percent(self) -> u16 {
        LEVELS[self.index]
    }

    /// The scale GPUI draws at, where 1 is unzoomed.
    pub fn factor(self) -> f32 {
        f32::from(self.percent()) / 100.
    }

    /// Whether a larger step is left.
    pub fn can_increase(self) -> bool {
        self.index + 1 < LEVELS.len()
    }

    /// Whether a smaller step is left.
    pub fn can_decrease(self) -> bool {
        self.index > 0
    }

    fn increase(&mut self) {
        self.index = (self.index + 1).min(LEVELS.len() - 1);
    }

    fn decrease(&mut self) {
        self.index = self.index.saturating_sub(1);
    }

    fn reset(&mut self) {
        *self = Self::default();
    }

    /// Moves one step, or back to 100%; past either end it stays put.
    pub fn apply(&mut self, command: ZoomCommand) {
        match command {
            ZoomCommand::In => self.increase(),
            ZoomCommand::Out => self.decrease(),
            ZoomCommand::Reset => self.reset(),
        }
    }
}

/// A step through the zoom, from the View menu, the toolbar or a shortcut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoomCommand {
    /// One step larger.
    In,
    /// One step smaller.
    Out,
    /// Back to 100%.
    Reset,
}

/// The zoom command a key press asks for by the platform's usual shortcuts. The shell
/// checks every key before a focused text field sees it, so the shortcuts work anywhere.
pub fn zoom_shortcut(keystroke: &Keystroke) -> Option<ZoomCommand> {
    if !keystroke.modifiers.secondary() || keystroke.modifiers.alt {
        return None;
    }
    match keystroke.key.as_str() {
        "+" | "=" => Some(ZoomCommand::In),
        "-" | "_" => Some(ZoomCommand::Out),
        "0" => Some(ZoomCommand::Reset),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_steps_fill_the_range_the_theme_allows() {
        let (min, max) = study_ui::ZOOM_RANGE;
        let factors = LEVELS.map(|percent| f32::from(percent) / 100.);
        assert_eq!(factors.first(), Some(&min));
        assert_eq!(factors.last(), Some(&max));
        assert!(factors.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(LEVELS[UNZOOMED], 100);
    }

    #[test]
    fn saved_zoom_level_restores_exact_step() {
        assert_eq!(ZoomLevel::default().percent(), 100);
        assert_eq!(ZoomLevel::from_percent(125).percent(), 125);
        assert_eq!(ZoomLevel::from_percent(999).percent(), 100);
    }

    #[test]
    fn zoom_steps_are_bounded_and_reset_exactly() {
        let mut zoom = ZoomLevel::default();
        zoom.increase();
        assert_eq!(zoom.percent(), 110);
        zoom.increase();
        assert_eq!(zoom.percent(), 125);
        for _ in 0..20 {
            zoom.increase();
        }
        assert_eq!(zoom.percent(), 200);
        assert!(!zoom.can_increase());
        for _ in 0..20 {
            zoom.decrease();
        }
        assert_eq!(zoom.percent(), 75);
        assert!(!zoom.can_decrease());
        zoom.reset();
        assert_eq!(zoom.percent(), 100);
        assert_eq!(zoom.factor(), 1.);
    }
}
