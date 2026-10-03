//! Quiz: endless questions over a whole project. The sidebar lists the projects; choosing one
//! opens its quiz, or starts it, and the page asks one question at a time, grades it, and
//! keeps the results below. The question on screen, and the header and results of a quiz
//! live in `components/`.
//!
//! Questions are written, and open answers graded, in the background. The database is the
//! source of truth; job events only say when to look again.

use super::ids;
use crate::ui::screens::shell::page::pages::components::{FirstLoad, quiet, status_line};
use crate::ui::screens::shell::page::*;
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::component::input::{InputEvent, TextareaState};
use gpui_kit::{AppContext as _, Entity, FocusHandle, SharedString, Subscription, Window};
use std::collections::HashSet;
use study_app::views::{
    Practice, PracticeAnswer, PracticeBody, PracticeQuestion, PracticeSummary, Project,
    QuestionKind, QuestionStatus,
};
use study_core::{JobId, PracticeId, ProjectId, QuestionId};
use study_localization::practice_score;
use study_ui::{ContentPage, MenuItem, PageView, SectionSidebar, scaled_px};

/// The keys that go on to the next question, as GPUI names them.
const ENTER: &str = "enter";
const SPACE: &str = "space";

/// The Quiz page: every project with its quiz, and the open one.
pub(in crate::ui::screens::shell::page) struct PracticeState {
    /// Every quiz, one per project that has started one.
    pub(super) practices: Vec<PracticeSummary>,
    /// The quiz chosen in the sidebar; the latest one when none was.
    pub(super) open: Option<PracticeId>,
    /// The open quiz with its questions, as last loaded.
    pub(super) practice: Option<Practice>,
    /// Every project: each lists in the sidebar and names its quiz.
    pub(super) projects: Vec<Project>,
    /// The question just answered, kept on screen with its verdict until the student moves
    /// on; without one, the first question still unanswered shows.
    pub(super) current: Option<QuestionId>,
    /// The results opened to show how each went.
    pub(super) expanded: HashSet<QuestionId>,
    /// Where an open question is answered.
    pub(super) answer: Entity<TextareaState>,
    answer_locale: Option<Locale>,
    /// The quiz the answer box's text was written for: another quiz's is cleared before
    /// the box shows, which needs the window.
    answer_for: Option<PracticeId>,
    /// Takes the keyboard for the question on screen: its choices, and going on.
    pub(super) question_focus: FocusHandle,
    /// The question (and whether it was answered) the keyboard last went to.
    focused_for: Option<(QuestionId, bool)>,
    /// An answer or a new quiz is being stored.
    pub(super) busy: bool,
    /// Whether a load has ever finished, so the page knows it has something to show.
    loaded: bool,
    loading: Serial,
    pub(in crate::ui::screens::shell::page) error: Option<Message>,
    /// The questions put into their practice's flashcard set of mistakes.
    pub(super) carded: HashSet<QuestionId>,
    /// Deleting the open quiz waits for a confirmation.
    pub(super) confirm_delete: bool,
    _answer_subscription: Subscription,
}

impl PracticeState {
    pub(in crate::ui::screens::shell::page) fn new(
        window: &mut Window,
        cx: &mut Context<AppShell>,
    ) -> Self {
        let answer = cx.new(|cx| TextareaState::new(window, cx).submit_on_enter(true));
        let subscription = cx.subscribe_in(
            &answer,
            window,
            |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { shift: false, .. } => this.submit_open_answer(window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            },
        );
        Self {
            practices: Vec::new(),
            open: None,
            practice: None,
            projects: Vec::new(),
            current: None,
            expanded: HashSet::new(),
            answer,
            answer_locale: None,
            answer_for: None,
            question_focus: cx.focus_handle(),
            focused_for: None,
            busy: false,
            loaded: false,
            loading: Serial::default(),
            error: None,
            carded: HashSet::new(),
            confirm_delete: false,
            _answer_subscription: subscription,
        }
    }

    /// The name of the project `practice` draws from; it names the quiz.
    pub(super) fn title_of(&self, practice: &Practice) -> String {
        self.projects
            .iter()
            .find(|project| project.id == practice.project_id)
            .map(|project| project.name.clone())
            .unwrap_or_default()
    }

    /// Shows `message` if what failed was for `showing`, the quiz still on screen; a late
    /// failure leaves another quiz's page alone.
    pub(super) fn fail_in(&mut self, showing: Option<PracticeId>, message: Message) {
        if self.open == showing {
            self.error = Some(message);
        }
    }

    /// The question on screen in the open quiz.
    pub(super) fn current_question(&self) -> Option<&PracticeQuestion> {
        current_question(self.practice.as_ref()?, self.current)
    }
}

/// The question on screen: the one just answered until the student moves on, else the
/// first one still waiting for an answer, written or not.
pub(super) fn current_question(
    practice: &Practice,
    answered: Option<QuestionId>,
) -> Option<&PracticeQuestion> {
    answered
        .and_then(|id| practice.questions.iter().find(|question| question.id == id))
        .or_else(|| {
            practice
                .questions
                .iter()
                .find(|question| question.status.is_unanswered())
        })
}

/// What one load of the Quiz page reads from the database.
pub(super) struct PracticeRead {
    pub(super) practices: Vec<PracticeSummary>,
    /// The quiz asked for when it still exists, else the latest one.
    pub(super) open: Option<PracticeId>,
    pub(super) practice: Option<Practice>,
    pub(super) projects: Vec<Project>,
}

impl PracticeRead {
    /// Reads every project and quiz, and `chosen`, or the latest quiz when `chosen` is gone.
    /// Blocks on the database.
    pub(super) fn read(
        app: &study_app::App,
        chosen: Option<PracticeId>,
    ) -> study_core::Result<Self> {
        let practices = app.practices()?;
        let open = chosen
            .filter(|id| practices.iter().any(|practice| practice.id == *id))
            .or_else(|| practices.first().map(|practice| practice.id));
        let practice = match open {
            Some(id) => app.practice(id)?,
            None => None,
        };
        Ok(Self {
            practices,
            open,
            practice,
            projects: app.projects()?,
        })
    }
}

impl AppShell {
    /// Reads every project and quiz, and the open one.
    pub(in crate::ui::screens::shell::page) fn load_practice(&mut self, cx: &mut Context<Self>) {
        if !self.practice.loading.start() {
            return;
        }
        let chosen = self.practice.open;
        self.background(
            move |app| PracticeRead::read(app, chosen),
            move |view, result, cx| {
                let state = &mut view.practice;
                state.loaded = true;
                match acted(result) {
                    // Another quiz was chosen while this load ran: its own load follows, so
                    // this one is stale.
                    Some(_) if state.open != chosen => {}
                    Some(read) => {
                        state.practices = read.practices;
                        state.open = read.open;
                        state.practice = read.practice;
                        state.projects = read.projects;
                        if state.error == Some(Message::PracticeLoadError) {
                            state.error = None;
                        }
                    }
                    None => state.error = Some(Message::PracticeLoadError),
                }
                if state.loading.finish() {
                    view.load_practice(cx);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Keeps the answer box's placeholder in the chosen language and its text with the quiz
    /// it was written for, and gives the keyboard to a question as it comes on screen or is
    /// answered: the answer box of an open question waiting for its answer, else the
    /// question itself. Runs from `render`, which has the window these need.
    pub(in crate::ui::screens::shell::page) fn sync_practice(
        &mut self,
        locale: Locale,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.practice.answer_locale != Some(locale) {
            self.practice.answer_locale = Some(locale);
            self.practice.answer.update(cx, |input, cx| {
                input.set_placeholder(text(locale, Message::AnswerPlaceholder), window, cx)
            });
        }
        if self.practice.answer_for != self.practice.open {
            self.practice.answer_for = self.practice.open;
            self.practice
                .answer
                .update(cx, |input, cx| input.set_value(String::new(), window, cx));
        }
        let shown = self
            .practice
            .current_question()
            .filter(|question| question.written.is_some())
            .map(|question| {
                let answered = question.status != QuestionStatus::Ready;
                (question.id, answered, question.kind)
            });
        let Some((id, answered, kind)) = shown else {
            self.practice.focused_for = None;
            return;
        };
        if self.practice.focused_for == Some((id, answered)) {
            return;
        }
        self.practice.focused_for = Some((id, answered));
        if kind == QuestionKind::Open && !answered {
            self.practice
                .answer
                .update(cx, |input, cx| input.focus(window, cx));
        } else {
            window.focus(&self.practice.question_focus, cx);
        }
    }

    /// A key pressed on the question on screen: a letter or a number picks that choice of a
    /// choice question waiting for its answer, and Enter or Space goes on once it is
    /// answered. Whether the key was used.
    pub(super) fn practice_key(
        &mut self,
        key: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(question) = self.practice.current_question() else {
            return false;
        };
        if question.status != QuestionStatus::Ready {
            if key == ENTER || key == SPACE {
                self.next_question(cx);
                return true;
            }
            return false;
        }
        let Some(PracticeBody::Choice { choices, .. }) =
            question.written.as_ref().map(|written| &written.body)
        else {
            return false;
        };
        let mut chars = key.chars();
        let index = match (chars.next(), chars.next()) {
            (Some(digit @ '1'..='9'), None) => digit as u32 - '1' as u32,
            (Some(letter @ 'a'..='z'), None) => letter as u32 - 'a' as u32,
            _ => return false,
        };
        if index as usize >= choices.len() || self.practice.busy {
            return false;
        }
        let id = question.id;
        self.answer_choice(id, index, window, cx);
        true
    }

    /// Opens a quiz on the Quiz page.
    pub(in crate::ui::screens::shell::page) fn show_practice(
        &mut self,
        id: PracticeId,
        cx: &mut Context<Self>,
    ) {
        self.choose_practice(id, cx);
        self.navigate(Page::Practice, cx);
    }

    pub(super) fn choose_practice(&mut self, id: PracticeId, cx: &mut Context<Self>) {
        let state = &mut self.practice;
        if state.open != Some(id) {
            state.open = Some(id);
            state.practice = None;
            state.current = None;
            state.expanded.clear();
            // What was under way on the quiz open before is not this one's.
            state.confirm_delete = false;
        }
        // Another quiz's problem is not this one's.
        state.error = None;
        self.load_practice(cx);
        cx.notify();
    }

    /// Opens the quiz of `project`, starting it when it has none yet.
    pub(in crate::ui::screens::shell::page) fn open_project_practice(
        &mut self,
        project: ProjectId,
        cx: &mut Context<Self>,
    ) {
        if let Some(practice) = self
            .practice
            .practices
            .iter()
            .find(|practice| practice.project_id == project)
        {
            let id = practice.id;
            self.choose_practice(id, cx);
            return;
        }
        self.practice.error = None;
        if self.practice.busy || !self.workers.allow(&mut self.practice.error, cx) {
            return;
        }
        self.practice.busy = true;
        cx.notify();
        self.background(
            move |app| app.project_practice(project),
            |view, result, cx| {
                view.practice.busy = false;
                match result {
                    Ok(id) => view.choose_practice(id, cx),
                    Err(error) => {
                        crate::features::errors::report(&error);
                        view.practice.fail_in(None, Message::ActionError);
                        cx.notify();
                    }
                }
            },
            cx,
        );
    }

    /// Answers the question on screen with one of its choices.
    pub(super) fn answer_choice(
        &mut self,
        question: QuestionId,
        choice: u32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.answer(question, PracticeAnswer::Choice(choice), window, cx);
    }

    /// Sends what the answer box holds as the answer to the open question on screen.
    pub(super) fn submit_open_answer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(question) = self
            .practice
            .current_question()
            .filter(|question| {
                question.kind == QuestionKind::Open && question.status == QuestionStatus::Ready
            })
            .map(|question| question.id)
        else {
            return;
        };
        let answer = self.practice.answer.read(cx).value().trim().to_owned();
        if answer.is_empty() {
            return;
        }
        self.answer(question, PracticeAnswer::Open(answer), window, cx);
    }

    /// Stores `answer` and keeps the question on screen to show how it went. The answer box
    /// empties once an answer is stored, and keeps what was written when it is not.
    fn answer(
        &mut self,
        question: QuestionId,
        answer: PracticeAnswer,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.practice.error = None;
        if self.practice.busy || !self.workers.allow(&mut self.practice.error, cx) {
            return;
        }
        let showing = self.practice.open;
        self.practice.busy = true;
        self.practice.current = Some(question);
        cx.notify();
        self.background_in_window(
            window,
            move |app| app.answer_question(question, &answer),
            move |view, result, window, cx| {
                view.practice.busy = false;
                match result {
                    // The box holds this quiz's answer only while this quiz shows.
                    Ok(_) if view.practice.open == showing => view
                        .practice
                        .answer
                        .update(cx, |input, cx| input.set_value(String::new(), window, cx)),
                    Ok(_) => {}
                    Err(error) => {
                        crate::features::errors::report(&error);
                        view.practice.fail_in(showing, Message::ActionError);
                    }
                }
                view.load_practice(cx);
            },
            cx,
        );
    }

    /// Puts a question the student missed into the practice's flashcard set of mistakes.
    pub(super) fn add_to_flashcards(&mut self, id: QuestionId, cx: &mut Context<Self>) {
        let title = self
            .practice
            .practice
            .as_ref()
            .map(|practice| self.practice.title_of(practice))
            .unwrap_or_default();
        let title = study_localization::mistakes_title(self.preferences.language, &title);
        let showing = self.practice.open;
        // Marked at once, so the button cannot add it twice; unmarked if it did not work.
        self.practice.carded.insert(id);
        self.practice.error = None;
        cx.notify();
        self.background(
            move |app| app.add_to_flashcards(id, &title),
            move |view, result, cx| {
                if !matches!(result, Ok(true)) {
                    if let Err(error) = &result {
                        crate::features::errors::report(error);
                    }
                    view.practice.carded.remove(&id);
                    view.practice.fail_in(showing, Message::ActionError);
                }
                cx.notify();
            },
            cx,
        );
    }

    /// Moves on from the question just answered to the next one.
    pub(super) fn next_question(&mut self, cx: &mut Context<Self>) {
        self.practice.current = None;
        cx.notify();
    }

    /// Opens a result to show how the question went, or closes it.
    pub(super) fn toggle_result(&mut self, id: QuestionId, cx: &mut Context<Self>) {
        let expanded = &mut self.practice.expanded;
        if !expanded.remove(&id) {
            expanded.insert(id);
        }
        cx.notify();
    }

    /// Starts writing a question, or grading an answer, again.
    pub(super) fn retry_practice_job(&mut self, job: JobId, cx: &mut Context<Self>) {
        self.practice.error = None;
        if !self.workers.allow(&mut self.practice.error, cx) {
            return;
        }
        self.act(
            // `false` means the job already moved on; the reload shows how.
            move |app| app.retry_job(job).map(|_| true),
            |this| &mut this.practice.error,
            Message::ActionError,
            Self::load_practice,
            cx,
        );
    }

    /// Deletes a confirmed quiz, with every answer and grade in it.
    pub(super) fn delete_practice(&mut self, id: PracticeId, cx: &mut Context<Self>) {
        let state = &mut self.practice;
        state.confirm_delete = false;
        state.error = None;
        if state.open == Some(id) {
            state.open = None;
            state.practice = None;
            state.current = None;
            state.expanded.clear();
        }
        self.act(
            // `false` means it was already gone, which is what was asked.
            move |app| app.delete_practice(id).map(|_| true),
            |this| &mut this.practice.error,
            Message::ActionError,
            Self::load_practice,
            cx,
        );
    }

    pub(in crate::ui::screens::shell::page) fn practice_sidebar(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> SectionSidebar {
        let state = &self.practice;
        let mut sidebar = SectionSidebar::new(text(locale, Message::Practice));
        for project in &state.projects {
            let id = project.id;
            let practice = state
                .practices
                .iter()
                .find(|practice| practice.project_id == id);
            let mut item = MenuItem::new(
                (ids::PROJECT, id.get() as u64),
                SharedString::from(project.name.clone()),
            )
            .icon(Page::Practice.icon())
            .selected(practice.is_some_and(|practice| state.open == Some(practice.id)))
            .on_click(cx.listener(move |this, _, _, cx| this.open_project_practice(id, cx)));
            if let Some(score) = practice
                .map(|practice| practice.score)
                .filter(|s| s.answered > 0)
            {
                item = item.accessory(
                    div()
                        .text_size(scaled_px(cx, study_ui::scale::TEXT_CAPTION))
                        .text_color(cx.theme().colors.muted_foreground)
                        .child(SharedString::from(practice_score(
                            locale,
                            score.correct,
                            score.answered,
                        ))),
                );
            }
            sidebar = sidebar.item(item);
        }
        sidebar
    }

    pub(in crate::ui::screens::shell::page) fn practice_page(
        &self,
        locale: Locale,
        cx: &mut Context<Self>,
    ) -> PageView {
        let state = &self.practice;
        // Over a quiz, which has its own title, the page's description would be in the way.
        let practising = state.practice.is_some();
        let mut page = ContentPage::new(
            text(locale, Message::Practice),
            if practising {
                ""
            } else {
                text(locale, Message::PracticeDescription)
            },
        )
        .icon(Page::Practice.icon());
        let nothing_loaded = state.practices.is_empty() && state.projects.is_empty();
        let first = FirstLoad {
            loaded: state.loaded,
            failed: state.error == Some(Message::PracticeLoadError) && nothing_loaded,
            loading: Message::LoadingPractice,
            load_error: Message::PracticeLoadError,
            retry: Self::load_practice,
        };
        if !first.ready() {
            return first.notice(page, ids::RETRY_LOAD, locale, cx);
        }
        if let Some(practice) = &state.practice {
            page = self.practice_view(page, practice, locale, cx);
        } else if state.projects.is_empty() {
            // Nothing to draw questions from yet.
            page = page.item(quiet(text(locale, Message::PracticeNoProjects), cx));
        }
        status_line(page, state.error, false, locale).into()
    }
}
