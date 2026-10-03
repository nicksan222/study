//! One piece of study material, opened: a header that says what it is, then its text,
//! flashcards to turn over, or a diagram to move around in, and its sources.

use super::super::ids;
use super::super::page::Piece;
use super::card_face::{card_face, progress_bar};
use crate::ui::screens::shell::page::pages::components::{
    Alert, OnCite, citation_chip, job_problem_parts, material_status, material_writing,
    named_field, prose_citing, setup_requirement, status_icon,
};
use crate::ui::screens::shell::page::*;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::Textarea;
use gpui_kit::component::{
    ActiveTheme as _, Sizable as _,
    button::{Button, ButtonVariants as _},
};
use gpui_kit::{
    AnyElement, FontWeight, Role, SharedString, StatefulInteractiveElement as _,
    prelude::FluentBuilder as _,
};
use study_app::views::{Artifact, ArtifactBody, ArtifactKind, Flashcard, JobStatus};
use study_core::ArtifactId;
use study_localization::{card_count, cards_turned, joined, review_progress, source_count};
use study_ui::{ContentPage, PageIntro, button, units};

/// The extensions material is saved with.
const SVG: &str = "svg";
const MARKDOWN: &str = "md";
const TEXT: &str = "txt";

/// How tall a flashcard in the set's grid is at least, in units.
const CARD_HEIGHT: f32 = 132.;

impl AppShell {
    /// An opened piece of material: its header, what it holds (or how writing it goes), and
    /// the sources it cites.
    pub(in crate::ui::screens::shell::page::pages::study) fn artifact_view(
        &self,
        page: ContentPage,
        piece: &Piece,
        artifact: &Artifact,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        let unit = units(cx);
        // Text is read, so it sits in the reading column with its header and sources;
        // cards and diagrams spread over the whole width.
        let reading = matches!(artifact.body, None | Some(ArtifactBody::Text { .. }));
        let fit = |element: AnyElement| -> AnyElement {
            if reading {
                read_column(element)
            } else {
                element
            }
        };
        // What can be done with it sits in the title bar, as its icon buttons.
        let mut page = page;
        for action in self.material_actions(artifact, locale, cx) {
            page = page.action(action);
        }
        // The header sits over what it heads: in the reading column over text and cards,
        // flush with a diagram's canvas, which spreads over the whole width.
        let header = self.material_header(artifact, locale);
        let mut page = page.intro(match artifact.body {
            Some(ArtifactBody::Diagram { .. }) => header,
            _ => header.max_w(unit(study_ui::Column::Read.width())),
        });
        // Where the piece stands: up to date, outdated with Update, or its update's progress.
        if let Some(strip) = self.status_strip(piece, locale, cx) {
            page = page.item(read_column(strip));
        }
        let Some(body) = &artifact.body else {
            return self.unwritten_material(page, artifact, locale, cx);
        };
        match body {
            // Text reads as the page itself: body type in the reading column, no box.
            ArtifactBody::Text { text: body } => {
                page = page.item(fit(div()
                    .w_full()
                    .text_size(unit(study_ui::scale::TEXT_BODY))
                    .child(prose_citing(
                        body,
                        Some((
                            (ids::PROSE, artifact.id.get() as u64).into(),
                            self.material_cite(artifact, cx),
                        )),
                        cx,
                    ))
                    .into_any_element()));
            }
            ArtifactBody::Flashcards { cards } => {
                page = page.item(self.keyed(self.flashcards(artifact, cards, locale, cx), cx));
            }
            // The canvas is made as the diagram opens (see `sync_study`).
            ArtifactBody::Diagram { .. } => {
                // A raised tile with its own dot grid and hint (see `DiagramCanvas`).
                if let Some((_, canvas)) = &self.study.diagram {
                    page = page.item(div().w_full().child(canvas.clone()));
                }
            }
        }
        if !artifact.citations.is_empty() {
            page = page.item(fit(self.material_sources(artifact, locale, cx)));
        }
        page
    }

    /// What clicking a citation's number in the material's text does: opens the passage it
    /// cites over the page, as its row under the text would.
    fn material_cite(&self, artifact: &Artifact, cx: &mut Context<Self>) -> OnCite {
        let shell = cx.entity().downgrade();
        let cited: Vec<_> = artifact
            .citations
            .iter()
            .filter_map(|citation| {
                Some((
                    citation.marker,
                    citation.source_id?,
                    citation.source_name.clone(),
                    citation.anchor.clone(),
                ))
            })
            .collect();
        std::rc::Rc::new(move |marker, window, cx| {
            let Some((_, source, name, anchor)) = cited.iter().find(|(m, ..)| *m == marker) else {
                return;
            };
            let (source, name, anchor) = (*source, name.clone(), anchor.clone());
            shell
                .update(cx, |this, cx| {
                    this.peek_source(source, name, anchor, window, cx)
                })
                .ok();
        })
    }

    /// The passages the material cites, each opening where it is in its file: a quiet
    /// section under the material, its heading and the citations.
    fn material_sources(
        &self,
        artifact: &Artifact,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let mut chips = div()
            .w_full()
            .flex()
            .flex_wrap()
            .gap(unit(study_ui::scale::SPACE_XS));
        for citation in &artifact.citations {
            let id = (
                ids::CITATION,
                ids::packed(artifact.id, u64::from(citation.marker)),
            );
            chips = chips.child(citation_chip(
                id,
                citation,
                AppShell::peek_source,
                locale,
                cx,
            ));
        }
        study_ui::Section::new(text(locale, Message::AnswerSources))
            .count(artifact.citations.len())
            .mt(unit(study_ui::scale::SPACE_XL))
            .child(chips)
            .into_any_element()
    }

    /// The material's header, a plain title block: its title and a line of what it is (its
    /// project, when it was written, from how many sources). The title bar names the page,
    /// so no label of its kind sits above it.
    fn material_header(&self, artifact: &Artifact, locale: Locale) -> PageIntro {
        let facts = self.material_facts(artifact, locale);
        study_ui::PageIntro::title(artifact.title.clone())
            .when(!facts.is_empty(), |intro| intro.meta(joined(&facts)))
    }

    /// The facts under the title: the project (unless the title already says it), when and
    /// its sources and, for cards, how many.
    pub(in crate::ui::screens::shell::page) fn material_facts(
        &self,
        artifact: &Artifact,
        locale: Locale,
    ) -> Vec<String> {
        let project = self
            .study
            .projects
            .iter()
            .find(|project| project.id == artifact.project_id)
            .map(|project| project.name.clone())
            // A piece is titled after its project; saying it twice is noise.
            .filter(|name| *name != artifact.title);
        let mut facts: Vec<String> = Vec::new();
        facts.extend(project);
        if artifact.body.is_some() {
            facts.push(crate::features::clock::day(locale, artifact.updated_at));
        }
        if !artifact.sources.is_empty() {
            facts.push(source_count(locale, artifact.sources.len()));
        }
        if let Some(ArtifactBody::Flashcards { cards }) = &artifact.body {
            facts.push(card_count(locale, cards.len()));
        }
        facts
    }

    /// What can be done with the material, as the title bar's icon buttons: save it, copy
    /// it and delete it.
    fn material_actions(
        &self,
        artifact: &Artifact,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Vec<Button> {
        let mut actions = Vec::new();
        if let Some(body) = &artifact.body {
            actions.push(self.save_button(artifact, body.clone(), locale, cx));
            actions.push(self.copy_button(artifact.id, body, locale, cx));
        }
        actions.push(self.delete_button(artifact.id, locale, cx));
        actions
    }

    /// What the opened material asks before something goes, as an alert over it: deleting
    /// it, or deleting the card being edited.
    pub(in crate::ui::screens::shell::page) fn study_alert(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Option<Alert> {
        let state = &self.study;
        if let Some(id) = state.deleting {
            // Deleting cards takes their review history with them.
            let cards = state.open_artifact().is_some_and(|artifact| {
                artifact.id == id && artifact.kind == ArtifactKind::Flashcards
            });
            let (title, body) = if cards {
                (Message::AlertDeleteCards, Message::ConfirmDeleteCards)
            } else {
                (Message::AlertDeleteMaterial, Message::ConfirmDeleteMaterial)
            };
            let confirm = button(
                ids::CONFIRM_DELETE,
                text(locale, Message::DeleteMaterial),
                cx,
            )
            .danger()
            .on_click(cx.listener(move |this, _, _, cx| this.delete_material(id, cx)));
            return Some(Alert::new(
                text(locale, title),
                text(locale, body),
                confirm,
                ids::CANCEL_DELETE,
                |this, cx| {
                    this.study.deleting = None;
                    cx.notify();
                },
            ));
        }
        let editor = state
            .card_editor
            .as_ref()
            .filter(|editor| editor.confirm_delete)?;
        // The card's review history goes with it.
        let confirm = button(
            ids::CARD_CONFIRM_DELETE,
            text(locale, Message::DeleteCard),
            cx,
        )
        .danger()
        .disabled(editor.saving)
        .on_click(cx.listener(|this, _, _, cx| this.finish_card(true, cx)));
        let alert = Alert::new(
            text(locale, Message::AlertDeleteCard),
            text(locale, Message::ConfirmDeleteCard),
            confirm,
            ids::CARD_CANCEL_DELETE,
            |this, cx| {
                if let Some(editor) = &mut this.study.card_editor {
                    editor.confirm_delete = false;
                }
                cx.notify();
            },
        );
        Some(alert.locked(editor.saving))
    }

    /// Saves the material to a file where the student picks: a diagram as an SVG image,
    /// flashcards as Anki imports them, and text as Markdown.
    fn save_button(
        &self,
        artifact: &Artifact,
        body: ArtifactBody,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Button {
        let (id, title) = (artifact.id, artifact.title.clone());
        let (label, extension) = match body {
            ArtifactBody::Diagram { .. } => (Message::SaveImage, SVG),
            ArtifactBody::Flashcards { .. } => (Message::SaveForAnki, TEXT),
            ArtifactBody::Text { .. } => (Message::SaveMarkdown, MARKDOWN),
        };
        let saved = self.study.saved == Some(id);
        study_ui::icon_button(
            ids::SAVE_FILE,
            text(locale, if saved { Message::MaterialSaved } else { label }),
            if saved {
                IconName::Check
            } else {
                IconName::Download
            },
            cx,
        )
        .on_click(cx.listener(move |this, _, window, cx| {
            let content = match &body {
                ArtifactBody::Diagram { mermaid } => {
                    study_ui::diagram_svg(&study_diagram::mermaid::parse(mermaid).diagram, window)
                }
                other => other.exported(),
            };
            this.save_material(id, &title, extension, content, cx);
        }))
    }

    /// Copies the material as text other apps read (flashcards as Anki imports them), and
    /// then says so.
    fn copy_button(
        &self,
        id: ArtifactId,
        body: &ArtifactBody,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> Button {
        let copied = self.study.copied == Some(id);
        let exported = body.exported();
        study_ui::icon_button(
            ids::COPY,
            text(
                locale,
                if copied {
                    Message::MaterialCopied
                } else {
                    Message::CopyMaterial
                },
            ),
            if copied {
                IconName::Check
            } else {
                IconName::Copy
            },
            cx,
        )
        .on_click(cx.listener(move |this, _, _, cx| {
            cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string(exported.clone()));
            this.study.copied = Some(id);
            cx.notify();
        }))
    }

    /// Deleting the material, once confirmed below the header.
    fn delete_button(&self, id: ArtifactId, locale: Locale, cx: &mut Context<Self>) -> Button {
        study_ui::icon_button(
            ids::DELETE,
            text(locale, Message::DeleteMaterial),
            IconName::Trash,
            cx,
        )
        .toggled(self.study.deleting == Some(id))
        .on_click(cx.listener(move |this, _, _, cx| {
            this.study.deleting = Some(id);
            cx.notify();
        }))
    }

    /// The set as a deck, one large card at a time to turn and move through, then every
    /// card in a grid, where each is turned, written or deleted, and a new one added.
    fn flashcards(
        &self,
        artifact: &Artifact,
        cards: &[Flashcard],
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let mut column = div().w_full().flex().flex_col().gap(unit(16.));
        if !cards.is_empty() {
            column = column.child(self.deck(artifact, cards, locale, cx));
        }
        column
            .child(self.card_list(artifact, cards, locale, cx))
            .into_any_element()
    }

    /// The card the deck is at, large, turned by a click; then the way back and on, how far
    /// the deck is, and the keys.
    fn deck(
        &self,
        artifact: &Artifact,
        cards: &[Flashcard],
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let id = artifact.id;
        let count = cards.len();
        let at = self.study.deck_at(id, count);
        let card = &cards[at];
        let turned = self.study.turned.contains(&(id, at));
        let face = card_face(
            review_progress(locale, at + 1, count).into(),
            &card.front,
            turned.then_some(card.back.as_str()),
            Message::CardTapToReveal,
            locale,
            cx,
        );
        let (action, side, words) = if turned {
            (Message::HideAnswer, Message::CardBack, &card.back)
        } else {
            (Message::ShowAnswer, Message::CardFront, &card.front)
        };
        let deck_label = joined(&[
            text(locale, action).to_owned(),
            text(locale, side).to_owned(),
            words.clone(),
        ]);
        let step = |button_id: usize,
                    label: Message,
                    icon: IconName,
                    to: Option<usize>,
                    cx: &mut Context<Self>| {
            study_ui::icon_button(button_id, text(locale, label), icon, cx)
                .disabled(to.is_none())
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(to) = to {
                        this.study.deck.insert(id, to);
                        cx.notify();
                    }
                }))
        };
        let previous = step(
            ids::DECK_PREVIOUS,
            Message::PreviousCard,
            IconName::ArrowLeft,
            at.checked_sub(1),
            cx,
        );
        let next = step(
            ids::DECK_NEXT,
            Message::NextCard,
            IconName::ArrowRight,
            (at + 1 < count).then_some(at + 1),
            cx,
        );
        div()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(unit(14.))
            .py(unit(8.))
            .child(
                // Read as a button that shows the answer, or hides it again, then the side
                // it shows and what that side says.
                div()
                    .id(ids::DECK_CARD)
                    .test_support()
                    .role(Role::Button)
                    .aria_label(deck_label)
                    .w_full()
                    .max_w(unit(study_ui::Column::Read.width()))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.study.turned.remove(&(id, at)) {
                            this.study.turned.insert((id, at));
                        }
                        cx.notify();
                    }))
                    .child(face),
            )
            .child(
                study_ui::page_column(study_ui::Column::Read)
                    .flex()
                    .items_center()
                    .gap(unit(14.))
                    .child(previous)
                    .child(div().flex_1().child(progress_bar(at + 1, count, cx)))
                    .child(
                        div()
                            .flex_none()
                            .text_size(unit(study_ui::scale::TEXT_SMALL))
                            .text_color(palette.muted)
                            .child(review_progress(locale, at + 1, count)),
                    )
                    .child(next),
            )
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(palette.faint)
                    .child(text(locale, Message::FlashcardsHint)),
            )
            .into_any_element()
    }

    /// Every card, two to a row: how many are turned and a way to turn them all, then each
    /// card, the one being written in its place, and the way to add one.
    fn card_list(
        &self,
        artifact: &Artifact,
        cards: &[Flashcard],
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let id = artifact.id;
        let count = cards.len();
        let turned = (0..count)
            .filter(|index| self.study.turned.contains(&(id, *index)))
            .count();
        let all_turned = count > 0 && turned == count;
        let heading = div()
            .w_full()
            .flex()
            .items_center()
            .gap(unit(10.))
            .child(
                div()
                    .flex_1()
                    .text_size(unit(study_ui::scale::TEXT_TITLE))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(joined(&[
                        text(locale, Message::AllCards).to_owned(),
                        count.to_string(),
                    ])),
            )
            .child(
                div()
                    .text_size(unit(study_ui::scale::TEXT_CAPTION))
                    .text_color(study_ui::palette(cx).faint)
                    .child(cards_turned(locale, turned, count)),
            )
            .child(
                button(
                    ids::TURN_ALL,
                    text(
                        locale,
                        if all_turned {
                            Message::FlashcardsHideAll
                        } else {
                            Message::FlashcardsShowAll
                        },
                    ),
                    cx,
                )
                .small()
                .ghost()
                .icon(IconName::RotateCw)
                .on_click(cx.listener(move |this, _, _, cx| {
                    if all_turned {
                        this.study.turned.retain(|(artifact, _)| *artifact != id);
                    } else {
                        this.study
                            .turned
                            .extend((0..count).map(|index| (id, index)));
                    }
                    cx.notify();
                })),
            );
        let editing = self
            .study
            .card_editor
            .as_ref()
            .filter(|editor| editor.artifact == id)
            .map(|editor| editor.index);
        let at = self.study.deck_at(id, count);
        let mut grid = div().w_full().grid().grid_cols(2).gap(unit(12.));
        for (index, card) in cards.iter().enumerate() {
            grid = grid.child(if editing == Some(index) {
                self.card_editor(true, locale, cx)
            } else {
                self.flashcard(artifact, card, index, index == at, locale, cx)
            });
        }
        // At the end: the new card being written, or the way to write one.
        if editing == Some(count) {
            grid = grid.child(self.card_editor(false, locale, cx));
        } else {
            grid = grid.child(new_card(id, count, locale, cx));
        }
        div()
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(12.))
            .child(heading)
            .child(grid)
            .into_any_element()
    }

    /// Card `index` in the grid, turned over by a click, which also takes the deck to it:
    /// its number and question, and once turned its answer below. `current` marks the card
    /// the deck is at.
    fn flashcard(
        &self,
        artifact: &Artifact,
        card: &Flashcard,
        index: usize,
        current: bool,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let unit = units(cx);
        let palette = study_ui::palette(cx);
        let id = artifact.id;
        let shown = self.study.turned.contains(&(id, index));
        let sides = (card.front.clone(), card.back.clone());
        let edit = study_ui::icon_button(
            (ids::CARD_EDIT, ids::packed(id, index as u64)),
            text(locale, Message::EditCard),
            IconName::SquarePen,
            cx,
        )
        .xsmall()
        .on_click(cx.listener(move |this, _, window, cx| {
            cx.stop_propagation();
            this.edit_card(id, index, sides.clone(), window, cx)
        }));
        let number = div()
            .flex_none()
            .min_w(unit(22.))
            .h(unit(22.))
            .px(unit(study_ui::scale::SPACE_XS))
            .flex()
            .items_center()
            .justify_center()
            .rounded(unit(study_ui::scale::RADIUS_SM))
            .text_size(unit(study_ui::scale::TEXT_CAPTION))
            .bg(palette.active)
            .text_color(palette.muted)
            .child((index + 1).to_string());
        let question = div()
            .flex_1()
            .min_w_0()
            .whitespace_normal()
            .text_size(unit(study_ui::scale::TEXT_BODY))
            .font_weight(FontWeight::MEDIUM)
            .line_height(unit(24.))
            .child(SharedString::from(card.front.clone()));
        let answer = if shown {
            study_ui::body_text(cx)
                .w_full()
                .min_w_0()
                .pt(unit(study_ui::scale::SPACE_SM))
                .border_t_1()
                .border_color(palette.border)
                .child(SharedString::from(card.back.clone()))
        } else {
            div()
                .flex()
                .items_center()
                .gap(unit(study_ui::scale::SPACE_XS))
                .text_size(unit(study_ui::scale::TEXT_CAPTION))
                .text_color(palette.faint)
                .child(study_ui::icon(IconName::EyeOff).size(unit(14.)))
                .child(text(locale, Message::CardTapToReveal))
        };
        div()
            .id((ids::FLASHCARD, ids::packed(id, index as u64)))
            .test_support()
            .aria_label(SharedString::from(card.front.clone()))
            .w_full()
            .min_w_0()
            .min_h(unit(CARD_HEIGHT))
            .flex()
            .flex_col()
            .gap(unit(12.))
            .p(unit(16.))
            .rounded(unit(study_ui::scale::RADIUS_LG))
            .border_1()
            .cursor_pointer()
            // The card the deck is at is selected, as a row would be: the `active` tone.
            .map(|card| {
                if current {
                    card.bg(palette.active).border_color(palette.active)
                } else {
                    card.bg(palette.fill)
                        .border_color(palette.border)
                        .hover(|card| card.bg(palette.hover))
                }
            })
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_start()
                    .gap(unit(12.))
                    .child(number)
                    .child(question)
                    .child(edit),
            )
            .child(div().flex_1())
            .child(answer)
            .on_click(cx.listener(move |this, _, _, cx| {
                this.study.deck.insert(id, index);
                if !this.study.turned.remove(&(id, index)) {
                    this.study.turned.insert((id, index));
                }
                cx.notify();
            }))
            .into_any_element()
    }

    /// The card being written: its question and answer, then Save, Cancel and, for a card
    /// already in the set (`existing`), Delete.
    fn card_editor(&self, existing: bool, locale: Locale, cx: &mut Context<Self>) -> AnyElement {
        let unit = units(cx);
        let colors = cx.theme().colors;
        let Some(editor) = &self.study.card_editor else {
            return div().into_any_element();
        };
        div()
            .w_full()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(unit(8.))
            .p(unit(12.))
            .rounded(unit(study_ui::scale::RADIUS_LG))
            .border_1()
            .border_color(study_ui::palette(cx).muted)
            .bg(colors.background)
            .child(named_field(
                ids::CARD_FRONT,
                text(locale, Message::CardFront),
                Textarea::new(&editor.front)
                    .h(unit(64.))
                    .aria_label(text(locale, Message::CardFront)),
            ))
            .child(named_field(
                ids::CARD_BACK,
                text(locale, Message::CardBack),
                Textarea::new(&editor.back)
                    .h(unit(88.))
                    .aria_label(text(locale, Message::CardBack)),
            ))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(unit(6.))
                    .child(
                        button(ids::CARD_SAVE, text(locale, Message::SaveCard), cx)
                            .primary()
                            .small()
                            .disabled(editor.saving)
                            .on_click(cx.listener(|this, _, _, cx| this.finish_card(false, cx))),
                    )
                    .child(
                        button(ids::CARD_CANCEL, text(locale, Message::Cancel), cx)
                            .ghost()
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.study.card_editor = None;
                                cx.notify();
                            })),
                    )
                    .child(div().flex_1())
                    .when(existing && !editor.confirm_delete, |row| {
                        row.child(
                            button(ids::CARD_DELETE, text(locale, Message::DeleteCard), cx)
                                .ghost()
                                .small()
                                .icon(IconName::Trash)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(editor) = &mut this.study.card_editor {
                                        editor.confirm_delete = true;
                                    }
                                    cx.notify();
                                })),
                        )
                    }),
            )
            .into_any_element()
    }

    /// `content` taking the keyboard for opened flashcards (see `material_key`).
    fn keyed(&self, content: AnyElement, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id(ids::MATERIAL_KEYS)
            .test_support()
            .role(Role::Group)
            .aria_label(text(self.preferences.language, Message::FlashcardsHint))
            .w_full()
            .when_some(self.study.material_focus.as_ref(), |body, focus| {
                body.track_focus(focus)
            })
            .on_key_down(cx.listener(|this, event: &gpui_kit::KeyDownEvent, _, cx| {
                if study_ui::is_shortcut(event.keystroke.modifiers) {
                    return;
                }
                if this.material_key(&event.keystroke.key, cx) {
                    cx.stop_propagation();
                }
            }))
            .child(content)
            .into_any_element()
    }

    /// Material not written yet: while it is on its way, that it is being written; once it
    /// failed or stopped, why, with a way to start it again.
    fn unwritten_material(
        &self,
        page: ContentPage,
        artifact: &Artifact,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> ContentPage {
        if material_writing(artifact) {
            return self.writing_view(page, artifact, locale, cx);
        }
        let unit = units(cx);
        let colors = cx.theme().colors;
        // What went wrong (or that it waits), in small words: the danger colour only when
        // it failed.
        let (status, tint) = material_status(artifact, locale, &colors);
        let job = artifact.job.as_ref();
        let message = div()
            .flex()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XS))
            .text_size(unit(study_ui::scale::TEXT_SMALL))
            .text_color(tint)
            .children(
                job.filter(|job| job.status == JobStatus::Running)
                    .map(|job| status_icon(job.status, IconName::LoaderCircle, tint, unit(14.))),
            )
            .child(div().min_w_0().whitespace_normal().child(status));
        // Then what to do about it: try again, and the way to Settings.
        let mut actions = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(unit(study_ui::scale::SPACE_XS));
        if let Some(job) =
            job.filter(|job| job.status.is_stopped() || job.status == JobStatus::Waiting)
        {
            let key = artifact.id.get() as u64;
            actions = actions.children(job_problem_parts(
                ((ids::MATERIAL_RETRY, key), (ids::MATERIAL_SETTINGS, key)),
                job,
                self.chatgpt_state(),
                // The status already says what went wrong.
                None,
                AppShell::retry_material,
                locale,
                cx,
            ));
        }
        // In the reading column under the header, a group's space below its meta line,
        // whatever the material's kind (a diagram's canvas would spread wider).
        let line = div()
            .mt(unit(study_ui::scale::SPACE_LG))
            .w_full()
            .flex()
            .flex_col()
            .gap(unit(study_ui::scale::SPACE_XS))
            // The setup card says what is missing itself.
            .when(job.and_then(setup_requirement).is_none(), |line| {
                line.child(message)
            })
            .child(actions);
        page.item(read_column(line.into_any_element()))
    }
}

/// The place after the last card of set `id`, holding `count`, with the way to write a new
/// card there.
fn new_card(
    id: ArtifactId,
    count: usize,
    locale: Locale,
    cx: &mut Context<AppShell>,
) -> AnyElement {
    let unit = units(cx);
    div()
        .w_full()
        .min_h(unit(CARD_HEIGHT))
        .flex()
        .items_center()
        .justify_center()
        .rounded(unit(study_ui::scale::RADIUS_LG))
        .border_1()
        .border_dashed()
        .border_color(cx.theme().colors.border)
        .child(
            button(ids::CARD_ADD, text(locale, Message::AddCard), cx)
                .ghost()
                .icon(IconName::Plus)
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.edit_card(id, count, Default::default(), window, cx)
                })),
        )
        .into_any_element()
}

/// `element` in the reading column.
fn read_column(element: AnyElement) -> AnyElement {
    study_ui::page_column(study_ui::Column::Read)
        .child(element)
        .into_any_element()
}
