//! The Processing section of Settings: a row per kind of file Study reads, opening to a
//! switch for every processor its route in `study_core::processing::ROUTES` offers: how it
//! is read, how the text is tidied, what makes it searchable, and which study material it
//! offers, a column per stage. Each switch starts at the route's default; each change is
//! saved on its own as it is made. A first card holds what applies to every piece of
//! material, whatever its files ([`MaterialPreferences`]).

use super::super::ids;
use super::{setting_row, settings_card, unloaded_page, with_status};
use crate::ui::screens::shell::page::pages::components::{file_tile, kind_label, pill};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::{
    Disableable as _, Sizable as _,
    button::{Button, ButtonVariants as _},
    menu::{DropdownMenu as _, PopupMenuItem},
    switch::Switch,
};
use gpui_kit::prelude::FluentBuilder as _;
use study_core::processing::{
    ExtractorKind, MaterialPreferences, ProcessingPreferences, Processor, RefinerKind,
    Switch as Toggle,
};
use study_core::{JobKind, ReviewPreferences, SourceKind};
use study_localization::steps_on;
use study_ui::{ContentPage, button, units};

/// What the Processing section holds while Settings is open.
#[derive(Default)]
pub(in crate::ui::screens::shell::page) struct ProcessingState {
    /// `None` until loaded.
    preferences: Option<ProcessingPreferences>,
    /// Loaded with `preferences`.
    material: MaterialPreferences,
    /// Loaded with `preferences`.
    review: ReviewPreferences,
    loading: bool,
    /// The last load failed; the page offers to try again.
    load_failed: bool,
    /// Switches made so far; a load that started before the latest one would bring back
    /// what it changed, so its result is dropped.
    switches_made: u64,
    /// The last switch did not save, and the stored switches were read again.
    save_failed: bool,
    /// Saves, one run at a time, so the changes reach the database in the order they were
    /// made.
    saving: Serial,
    /// Changes shown and waiting for the next save run.
    queued: Vec<Change>,
    /// A save failed, or a load overlapped a save, so what shows may not be what is stored:
    /// the switches are read again once the saves are done.
    stale: bool,
    /// The kinds of file whose rows are open to show their switches.
    open: Vec<SourceKind>,
}

/// One change made in the section, saved on its own.
#[derive(Clone, Copy)]
enum Change {
    Switch(SourceKind, Processor, bool),
    Material(MaterialPreferences),
    Review(ReviewPreferences),
}

impl Change {
    fn save(self, app: &study_app::App) -> study_core::Result<()> {
        match self {
            Self::Switch(kind, processor, on) => app.switch_processor(kind, processor, on),
            Self::Material(preferences) => app.save_preferences(&preferences),
            Self::Review(preferences) => app.save_preferences(&preferences),
        }
    }
}

/// The groups a card lists its switches in, in order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Group {
    Reading,
    Tidying,
    Search,
    Material,
}

impl Group {
    const ALL: [Self; 4] = [Self::Reading, Self::Tidying, Self::Search, Self::Material];

    /// Every stage a route lists today makes the file searchable; a stage that did something
    /// else would need its own group (`every_stage_switch_is_about_search` fails first).
    fn of(processor: Processor) -> Self {
        match processor {
            Processor::Extractor(_) => Self::Reading,
            Processor::Refiner(_) => Self::Tidying,
            Processor::Stage(_) => Self::Search,
            Processor::Enhancer(_) => Self::Material,
        }
    }

    fn icon(self) -> IconName {
        match self {
            Self::Reading => IconName::BookOpen,
            Self::Tidying => IconName::WandSparkles,
            Self::Search => IconName::Search,
            Self::Material => IconName::GraduationCap,
        }
    }

    fn title(self) -> Message {
        match self {
            Self::Reading => Message::ProcessingReading,
            Self::Tidying => Message::ProcessingTidying,
            Self::Search => Message::ProcessingSearch,
            Self::Material => Message::ProcessingMaterial,
        }
    }
}

impl AppShell {
    /// Loads the switches whenever Settings opens, so a change made elsewhere (such as the
    /// plan applied after the first measurement) shows.
    pub(in crate::ui::screens::shell::page) fn ensure_processing_loaded(
        &mut self,
        cx: &mut Context<Self>,
    ) {
        if !self.processing.loading {
            self.load_processing(cx);
        }
    }

    fn load_processing(&mut self, cx: &mut Context<Self>) {
        let state = &mut self.processing;
        state.loading = true;
        state.load_failed = false;
        cx.notify();
        let started_after = state.switches_made;
        // A save under way, or waiting, may not be in what this load reads.
        let saving_then = state.saving.running() || !state.queued.is_empty();
        self.background(
            move |app| -> study_core::Result<_> {
                Ok((
                    app.processing()?,
                    app.preferences::<MaterialPreferences>()?,
                    app.preferences::<ReviewPreferences>()?,
                ))
            },
            move |view, result, cx| {
                let state = &mut view.processing;
                state.loading = false;
                match result {
                    // A change made meanwhile is newer than what this load read, and one
                    // saving then may not be in it: read again once the saves are done,
                    // which is now when none is running.
                    Ok(_)
                        if saving_then
                            || state.switches_made != started_after
                            || state.saving.running() =>
                    {
                        state.stale = true;
                        if !state.saving.running() {
                            view.load_processing(cx);
                            return;
                        }
                    }
                    Ok((preferences, material, review)) => {
                        state.stale = false;
                        state.preferences = Some(preferences);
                        state.material = material;
                        state.review = review;
                    }
                    Err(error) => {
                        crate::features::errors::report(&error);
                        state.load_failed = true;
                    }
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Switches `processor` for files of `kind` at once on screen, and saves just that
    /// switch.
    fn switch_processor(
        &mut self,
        kind: SourceKind,
        processor: Processor,
        on: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(preferences) = self.processing.preferences.as_mut() else {
            return;
        };
        preferences.set(kind, processor, on);
        self.save_change(Change::Switch(kind, processor, on), cx);
    }

    /// Opens or closes the row of a kind of file.
    fn toggle_kind(&mut self, kind: SourceKind, cx: &mut Context<Self>) {
        let open = &mut self.processing.open;
        if open.contains(&kind) {
            open.retain(|other| *other != kind);
        } else {
            open.push(kind);
        }
        cx.notify();
    }

    /// Switches sifting before material is written.
    fn switch_sift(&mut self, sift: bool, cx: &mut Context<Self>) {
        let material = MaterialPreferences { sift };
        self.processing.material = material;
        self.save_change(Change::Material(material), cx);
    }

    /// Sets how many new flashcards come a day.
    fn set_new_cards(&mut self, per_day: u32, cx: &mut Context<Self>) {
        let review = ReviewPreferences {
            new_cards_per_day: per_day,
        };
        self.processing.review = review;
        self.save_change(Change::Review(review), cx);
    }

    /// Saves `change`, already on screen, after the changes before it.
    fn save_change(&mut self, change: Change, cx: &mut Context<Self>) {
        let state = &mut self.processing;
        state.queued.push(change);
        state.switches_made += 1;
        state.save_failed = false;
        cx.notify();
        self.run_saves(cx);
    }

    /// Saves the queued changes in order, unless a run is under way, which saves them once
    /// it ends. A failed save is not guessed back on screen, since a later change may have
    /// failed too: once the saves are done, the stored switches are read again.
    fn run_saves(&mut self, cx: &mut Context<Self>) {
        let state = &mut self.processing;
        if !state.saving.start() {
            return;
        }
        let changes = std::mem::take(&mut state.queued);
        self.background(
            move |app| {
                let mut failed = false;
                for change in changes {
                    if let Err(error) = change.save(app) {
                        crate::features::errors::report(&error);
                        failed = true;
                    }
                }
                failed
            },
            move |view, failed, cx| {
                let state = &mut view.processing;
                if failed {
                    state.save_failed = true;
                    state.stale = true;
                }
                if state.saving.finish() {
                    view.run_saves(cx);
                } else if state.stale {
                    view.load_processing(cx);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// What applies to every piece of material: a row per setting, its name and what it
    /// does on the left and its control on the right.
    fn material_card(&self, locale: Locale, cx: &mut Context<Self>) -> gpui_kit::Div {
        let sift = Switch::new(ids::PROCESSING_SIFT)
            .checked(self.processing.material.sift)
            .on_click(cx.listener(|this, on: &bool, _, cx| this.switch_sift(*on, cx)));
        let shell = cx.entity().downgrade();
        let new_cards = button(
            ids::NEW_CARDS,
            self.processing.review.new_cards_per_day.to_string(),
            cx,
        )
        .small()
        .icon(IconName::ChevronDown)
        .dropdown_menu(move |menu, _, _| {
            NEW_CARD_CHOICES.iter().fold(menu, |menu, &per_day| {
                let shell = shell.clone();
                menu.item(
                    PopupMenuItem::new(per_day.to_string()).on_click(move |_, _, cx| {
                        let _ = shell.update(cx, |this, cx| this.set_new_cards(per_day, cx));
                    }),
                )
            })
        });
        settings_card(text(locale, Message::ProcessingEveryMaterial), cx)
            .child(setting_row(
                text(locale, Message::ProcessingSift),
                Some(text(locale, Message::ProcessingSiftHint).into()),
                sift,
                cx,
            ))
            .child(setting_row(
                text(locale, Message::NewCardsPerDay),
                Some(text(locale, Message::NewCardsPerDayHint).into()),
                new_cards,
                cx,
            ))
    }

    /// The Processing section: what applies to all material, then a card per kind of file
    /// that has a route.
    pub(in crate::ui::screens::shell::page) fn processing_page(
        &self,
        page: ContentPage,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let state = &self.processing;
        let Some(preferences) = state.preferences.as_ref().filter(|_| !state.load_failed) else {
            let retry = button(ids::PROCESSING_RETRY, text(locale, Message::Retry), cx)
                .on_click(cx.listener(|this, _, _, cx| this.load_processing(cx)));
            return unloaded_page(
                page,
                locale,
                !state.load_failed,
                None,
                Message::ProcessingLoadError,
                retry,
            );
        };
        let page = with_status(
            page,
            locale,
            state.save_failed.then_some((Message::SaveError, true)),
        );
        let page = page.item(self.material_card(locale, cx));
        let kinds = SourceKind::ALL
            .iter()
            .enumerate()
            .filter_map(|(place, &kind)| {
                let switches = preferences.switches(kind);
                (!switches.is_empty()).then_some((place, kind, switches))
            })
            .fold(
                settings_card(text(locale, Message::ProcessingByKind), cx),
                |list, (place, kind, switches)| {
                    let open = self.processing.open.contains(&kind);
                    list.child(Self::processing_row(
                        place, kind, &switches, open, locale, cx,
                    ))
                },
            );
        page.item(kinds)
    }

    /// One kind of file: a row with its glyph, name and how many steps are on, opening to its
    /// route, a column per stage. While nothing reads the file the rest cannot run, so it is
    /// shown disabled; so is a stage whose foundation (such as the index, for search by
    /// meaning) is off.
    fn processing_row(
        place: usize,
        kind: SourceKind,
        switches: &[Toggle],
        open: bool,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let read = switches
            .iter()
            .any(|toggle| Group::of(toggle.processor) == Group::Reading && toggle.on);
        let on = switches.iter().filter(|toggle| toggle.on).count();
        let name = text(locale, source_label(kind));
        let row = Button::new(ids::PROCESSING_KIND + place)
            .accessibility_label(name)
            .ghost()
            .w_full()
            .h_auto()
            .min_h(unit(40.))
            .justify_start()
            .gap(unit(study_ui::scale::SPACE_SM))
            .px(unit(study_ui::scale::SPACE_XS))
            .py(unit(6.))
            .rounded(unit(study_ui::scale::RADIUS_MD))
            .on_click(cx.listener(move |this, _, _, cx| this.toggle_kind(kind, cx)))
            .child(file_tile(kind, 20., cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(unit(2.))
                    .child(
                        div()
                            .text_size(unit(study_ui::scale::TEXT_UI))
                            .text_color(palette.foreground)
                            .child(name),
                    )
                    .children((!read).then(|| {
                        div()
                            .whitespace_normal()
                            .text_left()
                            .text_size(unit(study_ui::scale::TEXT_CAPTION))
                            .text_color(palette.faint)
                            .child(text(locale, Message::ProcessingNotRead))
                    })),
            )
            .child(pill(palette.muted, cx).child(steps_on(locale, on, switches.len())))
            .child(
                study_ui::icon(if open {
                    IconName::ChevronDown
                } else {
                    IconName::ChevronRight
                })
                .size(unit(14.))
                .text_color(palette.faint)
                .flex_none(),
            );
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XXS))
            .child(row)
            .when(open, |row| {
                row.child(Self::processing_stages(
                    place, kind, switches, read, locale, cx,
                ))
            })
    }

    /// An opened kind of file: its switches in a column per stage, inset on the raised tone.
    fn processing_stages(
        place: usize,
        kind: SourceKind,
        switches: &[Toggle],
        read: bool,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> gpui_kit::Div {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let is_on = |processor: Processor| {
            switches
                .iter()
                .any(|toggle| toggle.processor == processor && toggle.on)
        };
        let usable = |processor: Processor| match processor {
            Processor::Extractor(_) => true,
            Processor::Stage(stage) => {
                read && stage
                    .builds_on()
                    .is_none_or(|base| is_on(Processor::Stage(base)))
            }
            Processor::Refiner(_) | Processor::Enhancer(_) => read,
        };
        Group::ALL
            .into_iter()
            .filter_map(|group| {
                let members: Vec<(usize, Toggle)> = switches
                    .iter()
                    .copied()
                    .enumerate()
                    .filter(|(_, toggle)| Group::of(toggle.processor) == group)
                    .collect();
                (!members.is_empty()).then_some((group, members))
            })
            .fold(
                div()
                    .w_full()
                    .p(unit(study_ui::scale::SPACE_MD))
                    .flex()
                    .flex_wrap()
                    .gap_x(unit(study_ui::scale::SPACE_LG))
                    .gap_y(unit(study_ui::scale::SPACE_MD))
                    .rounded(unit(study_ui::scale::RADIUS_MD))
                    .bg(palette.fill),
                |stages, (group, members)| {
                    let heading = div()
                        .flex()
                        .items_center()
                        .gap(unit(6.))
                        .text_size(unit(study_ui::scale::TEXT_CAPTION))
                        .font_weight(gpui_kit::FontWeight::MEDIUM)
                        .text_color(palette.muted)
                        .child(study_ui::icon(group.icon()).size(unit(14.)))
                        .child(text(locale, group.title()));
                    let stage = members.into_iter().fold(
                        div()
                            .flex_1()
                            .min_w(unit(150.))
                            .flex()
                            .flex_col()
                            .gap(unit(study_ui::scale::SPACE_SM))
                            .child(heading),
                        |stage, (index, toggle)| {
                            let processor = toggle.processor;
                            stage.child(
                                Switch::new(switch_id(place, index))
                                    .checked(toggle.on)
                                    .disabled(!usable(processor))
                                    .label(text(locale, processor_label(processor)))
                                    .on_click(cx.listener(move |this, on: &bool, _, cx| {
                                        this.switch_processor(kind, processor, *on, cx);
                                    })),
                            )
                        },
                    );
                    stages.child(stage)
                },
            )
    }
}

/// How many new flashcards a day the menu offers.
const NEW_CARD_CHOICES: [u32; 6] = [10, 20, 30, 50, 100, 1000];

/// The element id of the switch at `index` in the card of the kind at `place` in
/// `SourceKind::ALL`.
fn switch_id(place: usize, index: usize) -> usize {
    let id = ids::PROCESSING_SWITCH + place * ids::PROCESSING_STRIDE + index;
    debug_assert!(
        id <= ids::PROCESSING_END,
        "processing ids ran past their range"
    );
    id
}

/// What a kind of file is called on its card.
fn source_label(kind: SourceKind) -> Message {
    match kind {
        SourceKind::Audio => Message::SourceAudio,
        SourceKind::Video => Message::SourceVideo,
        SourceKind::Image => Message::SourceImage,
        SourceKind::Pdf => Message::SourcePdf,
        SourceKind::Text => Message::SourceText,
        SourceKind::Code => Message::SourceCode,
        SourceKind::Document => Message::SourceDocument,
        SourceKind::Spreadsheet => Message::SourceSpreadsheet,
        SourceKind::Slides => Message::SourceSlides,
        SourceKind::Archive => Message::SourceArchive,
        SourceKind::Web => Message::SourceWeb,
        SourceKind::Link => Message::SourceLink,
        SourceKind::Note => Message::SourceNote,
        SourceKind::Other => Message::SourceOther,
    }
}

/// What a processor is called on its switch. Material uses its pages' names.
fn processor_label(processor: Processor) -> Message {
    match processor {
        Processor::Extractor(kind) => match kind {
            ExtractorKind::Transcription => Message::ExtractorTranscription,
            ExtractorKind::Vision => Message::ExtractorVision,
            ExtractorKind::Office => Message::ExtractorOffice,
            ExtractorKind::Web => Message::ExtractorWeb,
            ExtractorKind::Text => Message::ExtractorText,
        },
        Processor::Refiner(kind) => match kind {
            RefinerKind::Transcript => Message::RefinerTranscript,
            RefinerKind::Whitespace => Message::RefinerWhitespace,
        },
        Processor::Stage(kind) => match kind {
            JobKind::Extract => Message::StageReading,
            JobKind::Index => Message::StageIndex,
            JobKind::Embed => Message::StageEmbed,
            JobKind::Title => Message::StageTitle,
            JobKind::Reply => Message::StageReply,
            JobKind::Artifact => Message::StageArtifact,
            JobKind::Question => Message::StageQuestion,
            JobKind::Grade => Message::StageGrade,
            JobKind::Fetch => Message::StageFetch,
        },
        Processor::Enhancer(kind) => kind_label(kind),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_stage_switch_is_about_search() {
        for kind in SourceKind::ALL {
            for toggle in ProcessingPreferences::default().switches(*kind) {
                if let Processor::Stage(stage) = toggle.processor {
                    assert!(
                        matches!(stage, JobKind::Index | JobKind::Embed),
                        "{stage:?} is not a search stage: give it a group"
                    );
                }
            }
        }
    }

    /// Every card's switches fit in its id range, and the last card ends before the next
    /// base, so no switch shares an id.
    #[test]
    fn every_switch_has_its_own_id() {
        for kind in SourceKind::ALL {
            let count = ProcessingPreferences::default().switches(*kind).len();
            assert!(
                count < ids::PROCESSING_STRIDE,
                "{kind:?} has {count} switches"
            );
        }
        assert!(switch_id(SourceKind::ALL.len(), 0) <= ids::PROCESSING_END);
        const { assert!(ids::PROCESSING_RETRY < ids::PROCESSING_SWITCH) };
    }

    /// Within a card each switch reads differently, and the groups come in their order.
    #[test]
    fn every_card_labels_its_switches_apart_and_in_group_order() {
        for kind in SourceKind::ALL {
            let switches = ProcessingPreferences::default().switches(*kind);
            let mut labels: Vec<_> = switches
                .iter()
                .map(|toggle| format!("{:?}", processor_label(toggle.processor)))
                .collect();
            let count = labels.len();
            labels.sort();
            labels.dedup();
            assert_eq!(labels.len(), count, "{kind:?} repeats a label");
            let groups: Vec<usize> = switches
                .iter()
                .map(|toggle| {
                    Group::ALL
                        .iter()
                        .position(|group| *group == Group::of(toggle.processor))
                        .unwrap()
                })
                .collect();
            assert!(groups.is_sorted(), "{kind:?} mixes its groups");
        }
    }

    /// Sifting starts on, and its switch saves at once.
    #[gpui_kit::test]
    fn sifting_material_is_switched_off_and_saved(cx: &mut gpui_kit::TestAppContext) {
        use crate::app::preferences::Preferences;
        use crate::ui::screens::shell::page::SettingsSection;
        use crate::ui::screens::shell::page::testing::{click, open_shell, wait_until};

        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        click(cx, window, Page::Settings as usize);
        click(
            cx,
            window,
            ids::SECTION + SettingsSection::Processing as usize,
        );
        wait_until(cx, |cx| {
            cx.update(|cx| shell.read(cx).processing.preferences.is_some())
        });
        assert!(cx.update(|cx| shell.read(cx).processing.material.sift));

        click(cx, window, ids::PROCESSING_SIFT);
        let database = temp.database();
        wait_until(cx, |_| !MaterialPreferences::load(&database).unwrap().sift);
        assert!(!cx.update(|cx| shell.read(cx).processing.material.sift));
    }

    /// A load that a change overtakes is read again, even when the change has finished
    /// saving by the time the load ends, so the section never stays unloaded or old.
    #[gpui_kit::test(iterations = 50)]
    fn a_load_overtaken_by_a_change_is_read_again(cx: &mut gpui_kit::TestAppContext) {
        use crate::app::preferences::Preferences;
        use crate::ui::screens::shell::page::testing::{open_shell, wait_until};

        let temp = crate::testing::TempApp::new();
        let (_window, shell) = open_shell(cx, temp.app(), Preferences::default());
        cx.update(|cx| {
            shell.update(cx, |shell, cx| {
                shell.load_processing(cx);
                shell.switch_sift(false, cx);
            })
        });
        wait_until(cx, |cx| {
            cx.update(|cx| {
                let state = &shell.read(cx).processing;
                state.preferences.is_some() && !state.saving.running() && !state.loading
            })
        });
        assert!(!MaterialPreferences::load(&temp.database()).unwrap().sift);
        assert!(!cx.update(|cx| shell.read(cx).processing.material.sift));
    }

    /// Quick changes reach the database in the order they were made, so the last one is
    /// what is stored.
    #[gpui_kit::test]
    fn quick_changes_are_saved_in_order(cx: &mut gpui_kit::TestAppContext) {
        use crate::app::preferences::Preferences;
        use crate::ui::screens::shell::page::SettingsSection;
        use crate::ui::screens::shell::page::testing::{click, open_shell, wait_until};

        let temp = crate::testing::TempApp::new();
        let (window, shell) = open_shell(cx, temp.app(), Preferences::default());
        click(cx, window, Page::Settings as usize);
        click(
            cx,
            window,
            ids::SECTION + SettingsSection::Processing as usize,
        );
        wait_until(cx, |cx| {
            cx.update(|cx| shell.read(cx).processing.preferences.is_some())
        });
        cx.update(|cx| {
            shell.update(cx, |shell, cx| {
                for (sift, per_day) in [(false, 5), (true, 7), (false, 9)] {
                    shell.switch_sift(sift, cx);
                    shell.set_new_cards(per_day, cx);
                }
            })
        });
        wait_until(cx, |cx| {
            cx.update(|cx| {
                let state = &shell.read(cx).processing;
                !state.saving.running() && state.queued.is_empty()
            })
        });
        let database = temp.database();
        assert!(!MaterialPreferences::load(&database).unwrap().sift);
        assert_eq!(
            ReviewPreferences::load(&database)
                .unwrap()
                .new_cards_per_day,
            9
        );
    }
}
