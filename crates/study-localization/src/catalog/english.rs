//! English copy.

use crate::Message;

pub(super) fn text(message: Message) -> &'static str {
    match message {
        // App and window: menus, shortcuts and the title bar
        Message::AppName => "Study",
        Message::BrandMark => "S",
        Message::CloseWindow => "Close window",
        Message::Quit => "Quit Study",
        Message::ViewMenu => "View",
        Message::ZoomIn => "Zoom in (Ctrl/Cmd +)",
        Message::ZoomOut => "Zoom out (Ctrl/Cmd −)",
        Message::ResetZoom => "Reset zoom (Ctrl/Cmd 0)",
        Message::Back => "Back",
        Message::Forward => "Forward",
        Message::ToggleSidebar => "Toggle sidebar",
        Message::ToggleFullscreen => "Toggle fullscreen",

        // Navigation: the sidebar pages
        Message::Home => "Home",
        Message::MediaList => "Library",
        Message::Projects => "Projects",
        Message::Sessions => "Sessions",
        Message::Flashcards => "Flashcards",
        Message::Diagrams => "Diagrams",
        Message::Practice => "Practice",
        Message::Pipelines => "Activity",
        Message::Settings => "Settings",
        Message::Help => "Help",

        // Shared actions and states, used on more than one page
        Message::Save => "Save",
        Message::Saving => "Saving…",
        Message::SaveError => "Could not save this change. Try again.",
        Message::SaveMaterialError => "Could not save the material. Try again.",
        Message::Cancel => "Cancel",
        Message::Close => "Close",
        Message::Retry => "Retry",
        Message::GoToSettings => "Open settings",
        Message::WorkspaceUnavailable => {
            "Background processing is unavailable. Restart Study to try again."
        }
        Message::CopyText => "Copy text",
        Message::ActionError => "That did not work. Try again.",
        Message::Today => "Today",
        Message::Yesterday => "Yesterday",
        Message::Now => "now",
        Message::JustNow => "just now",

        // Search
        Message::Search => "Search",
        Message::SearchPlaceholder => "Search projects, sessions, and files…",
        Message::SearchPrompt => {
            "Type to search everything: names, messages, and what Study read from your files."
        }
        Message::SearchNoResults => "Nothing matches.",
        Message::SearchFailed => "Search is unavailable right now.",
        Message::SearchKeywordOnly => "Preparing search by meaning; showing exact matches for now.",
        Message::SearchProjects => "Projects",
        Message::SearchSessions => "Sessions",
        Message::SearchFiles => "Files",
        Message::SearchPassages => "In your files",
        Message::SearchMessages => "Messages",
        Message::SearchMove => "Move",
        Message::SearchOpen => "Open",
        Message::SearchClose => "Close",
        Message::SearchKeyUp => "↑",
        Message::SearchKeyDown => "↓",
        Message::SearchKeyEnter => "↵",
        Message::SearchKeyEscape => "esc",
        Message::SearchKindProject => "Project",
        Message::SearchKindSession => "Session",
        Message::SearchKindFile => "File",
        Message::SearchKindPassage => "Passage",
        Message::SearchKindMessage => "Message",

        // Startup: the first hardware measurement
        Message::StartupTitle => "Getting Study ready",
        Message::StartupIntro => {
            "The first time it opens, Study measures this computer to decide which models it can run here. The results are kept, so this happens only once."
        }
        Message::StartupMeasuring => "Measuring this computer…",
        Message::StartupFailed => "Could not finish measuring this computer. Try again.",
        Message::StartupSkip => "Continue without it",

        // Onboarding: the guided tour
        Message::OnboardingSkip => "Skip",
        Message::OnboardingNext => "Continue",
        Message::OnboardingStart => "Get started",
        Message::OnboardingFinish => "Start studying",
        Message::OnboardingWelcomeTitle => "Welcome to Study",
        Message::OnboardingWelcomeIntro => {
            "A calm place for everything you learn. Bring your lectures, slides and notes; Study reads them and turns them into material you can review."
        }
        Message::OnboardingCaptureTitle => "Capture everything",
        Message::OnboardingCaptureText => {
            "Notes, recordings, slides and links, kept together in a project for each course."
        }
        Message::OnboardingAskTitle => "Ask when you want",
        Message::OnboardingAskText => {
            "Type @study to ask a question that cites your own files. Study pages make flashcards and diagrams from a whole project."
        }
        Message::OnboardingReviewTitle => "Review what matters",
        Message::OnboardingReviewText => {
            "Flashcards, diagrams and practice questions from your own material."
        }
        Message::OnboardingLookTitle => "Make it yours",
        Message::OnboardingLookIntro => {
            "Pick a language and a look. You can change both later in Settings."
        }
        Message::OnboardingNotesTitle => "Sessions are your notebook",
        Message::OnboardingNotesIntro => {
            "Write, record and attach as you study. Study transcribes recordings, reads your files and names each session in the background."
        }
        Message::OnboardingSampleNote => "Krebs cycle: eight steps, inside the mitochondria.",
        Message::OnboardingSampleFile => "lecture-06.mp3",
        Message::OnboardingSampleQuestion => "@study why does it stop without oxygen?",
        Message::OnboardingSampleAnswer => {
            "Oxygen takes the electrons at the end of the transport chain. Without it, NAD+ runs out and the cycle stalls [1]."
        }
        Message::OnboardingNotesHint => "Only a note that mentions @study gets an answer.",
        Message::OnboardingAiTitle => "Where AI runs",
        Message::OnboardingAiIntro => {
            "Study reads, writes and answers with your ChatGPT plan. Only listening to recordings and searching run here, privately, once their models are downloaded."
        }
        Message::OnboardingAiDownload => "Download what runs here",
        Message::OnboardingAiDownloading => "Downloading models… this can take a while.",
        Message::OnboardingAiDownloaded => "Everything that runs here is downloaded.",
        Message::OnboardingAiChatGpt => {
            "Sign in with ChatGPT Plus or Pro: reading your files, study material and answers run on your plan."
        }
        Message::OnboardingAiChatGptReady => "The language models run on your ChatGPT plan.",
        Message::OnboardingAiWaitForModels => {
            "When you continue, what runs here downloads in the background, and you can start studying meanwhile."
        }
        Message::OnboardingAiLater => "You can change any of this later in Settings, under AI.",
        Message::OnboardingAiFailed => {
            "Study could not measure this computer. You can choose where each feature runs in Settings."
        }
        Message::OnboardingReadyTitle => "You're all set",
        Message::OnboardingReadyIntro => {
            "Create a project for each course, start a session, and drop in your first lecture."
        }
        Message::OnboardingOpenAiSettings => "Review AI settings",

        // Home: the dashboard
        Message::GreetingMorning => "Good morning",
        Message::GreetingAfternoon => "Good afternoon",
        Message::GreetingEvening => "Good evening",
        Message::LoadingDashboard => "Loading the overview…",
        Message::DashboardLoadError => "Could not load the overview. Try again.",
        Message::TodayDue => "Flashcards from every project, due for review now.",
        Message::TodayNothingDue => "You're up to date",
        Message::TodayPractise => "No cards are due. A few practice questions keep it fresh.",
        Message::ReviewNow => "Review now",
        Message::ContinueTitle => "Pick up where you left off",
        Message::DashboardNoSessions => "No sessions yet. Start one to study your files.",
        Message::AllCaughtUp => "All caught up. Nothing is running, and nothing needs you.",
        Message::OpenPipelines => "Open activity",
        Message::RecentFiles => "Recent files",
        Message::NoFilesYet => {
            "No files yet. Add lecture recordings, slides, or notes to get started."
        }
        Message::OpenLibrary => "Open library",
        Message::OpenInLibrary => "Open in Library",
        Message::SeeDetails => "See details",
        Message::RunsHere => "On this computer",
        Message::NotRecommendedHere => "Not recommended here",
        Message::AddFiles => "Add files",
        Message::NewProjectAction => "New project",
        Message::NoProjectsYet => {
            "Create a project for each course you study, then start sessions and add files to it."
        }

        // Library: files, import and preview
        Message::LoadingMedia => "Loading files…",
        Message::MediaLoadError => "Could not load your files. Try again.",
        Message::NoMediaYet => "No files yet. Add one to get started.",
        Message::AllMedia => "All files",
        Message::SearchMedia => "Search files",
        Message::NoMatchingMedia => "No files found. Try another search or project.",
        Message::MediaActions => "File actions",
        Message::UploadMedia => "Add files",
        Message::DropMediaFiles => "Drop files here",
        Message::DropFilesToAttach => "Drop files here to attach them",
        Message::UploadMediaHint => "Or choose files from your computer",
        Message::MediaFile => "File",
        Message::ChooseMediaFile => "Choose files",
        Message::AssociateWithProject => "Project",
        Message::NoProject => "No project",
        Message::ImportingMedia => "Importing file…",
        Message::MediaPickerError => "Could not open the file picker. Try again.",
        Message::MediaImportError => {
            "Could not import this file. Use a nonempty file under 512 MiB and try again."
        }
        Message::MediaAssociateError => "Could not update the project for this file. Try again.",
        Message::LoadingPreview => "Loading preview…",
        Message::OpenMedia => "Open in default app",
        Message::OpenPage => "Open page",
        Message::ReadFromFile => "What was read",
        Message::ShowFromStart => "Show earlier text",
        Message::MediaOpenError => "Could not open this file.",
        Message::DeleteMedia => "Delete file",
        Message::AlertDeleteMedia => "Delete this file?",
        Message::ConfirmDeleteMedia => "The file is removed from Study. This cannot be undone.",
        Message::MediaDeleteError => "Could not delete this file. Try again.",

        // Library: notes and links written in the app
        Message::NewNote => "New note",
        Message::NoteTitle => "Title",
        Message::NoteBodyPlaceholder => "Write your note…",
        Message::SaveNote => "Save note",
        Message::NoteIncomplete => "A note needs a title and some text.",
        Message::AddLink => "Add link",
        Message::LinkPlaceholder => "https://…",
        Message::AddLinkHint => {
            "A web page is saved and read. A YouTube video's sound is transcribed; that needs the yt-dlp program installed."
        }
        Message::AddingLink => "Fetching…",
        Message::LinkMissing => "Paste a web address first.",
        Message::MadeSourceError => {
            "That did not work. Check the address, or for a video that yt-dlp is installed."
        }

        // Projects
        Message::ProjectsSaveError => "Could not save this project. Try again.",
        Message::ProjectsDeleteError => "Could not delete this project. Try again.",
        Message::NewProject => "New project",
        Message::CreateProject => "Create project",
        Message::RenameProject => "Rename project",
        Message::DeleteProject => "Delete project",
        Message::AlertDeleteProject => "Delete this project?",
        Message::ConfirmDeleteProject => {
            "Its sessions and study material go with it. Files stay in the Library."
        }
        Message::ProjectName => "Project name",
        Message::ProjectNameDescription => {
            "Give this project a name you will recognize, such as a course."
        }
        Message::ProjectNameError => "Enter a name of 1 to 100 characters.",
        Message::ProjectDetailDescription => {
            "Everything you study for this course: sessions, files and study material."
        }
        Message::ProjectEmptyDescription => {
            "Start a session to take notes and add files, then make flashcards and diagrams from it on their pages."
        }
        Message::ProjectDetails => "Project details",
        Message::ViewProjectFiles => "View files",
        Message::ExamDay => "Exam day",
        Message::ExamDayPlaceholder => "Pick the day",
        Message::ExamDayHint => {
            "Home and the flashcard reviews count down to it, nearest exam first."
        }
        Message::OpenProjectCards => "Review flashcards",
        Message::ProjectMaterial => "Study material",
        Message::OpenProjectQuiz => "Take the quiz",

        // Sessions: the list and the conversation
        Message::NewSession => "New session",
        Message::LoadingSessions => "Loading sessions…",
        Message::SessionsLoadError => "Could not load sessions. Try again.",
        Message::SessionsSaveError => "Could not update the session. Try again.",
        Message::StartSession => "Start a session",
        Message::StartSessionDescription => {
            "Sessions keep what you send and what Study makes of it, such as transcripts, together."
        }
        Message::StartWithRecording => "Record a lecture",
        Message::StartWithRecordingDescription => "Transcribed on this computer as you listen.",
        Message::StartWithFiles => "Add files",
        Message::StartWithFilesDescription => "Slides, PDFs, photos or recordings, read for you.",
        Message::StartWithQuestion => "Ask @study",
        Message::StartWithQuestionDescription => "An answer that cites your own files.",
        Message::NoProjectsForSessions => "Create a project first. Every session belongs to one.",
        Message::ChooseProject => "Choose a project",
        Message::GoToProjects => "Go to Projects",
        Message::SessionEmptyHint => {
            "Write notes, record or attach files. Audio is transcribed automatically; type @study to ask the assistant."
        }
        Message::DeleteSession => "Delete session",
        Message::AlertDeleteSession => "Delete this session?",
        Message::ConfirmDeleteSession => {
            "Its messages and the material made in it go with it. Attached files stay in the Library."
        }
        Message::DeleteMessage => "Delete",
        Message::AlertDeleteMessage => "Delete this message?",
        Message::ConfirmDeleteMessage => {
            "Its answers, threads and material go with it. Files stay in the Library."
        }
        Message::AnswerAgain => "Answer again",
        Message::RegenerateTitle => "Regenerate title from the notes",
        Message::RegeneratingTitle => "Generating a new title…",
        Message::TitleGenerationError => {
            "Could not generate a title. Check the language model settings and try again."
        }
        Message::LoadingMessages => "Loading messages…",
        Message::MessagesLoadError => "Could not load this session. Try again.",
        Message::ComposerPlaceholder => "Write a note, or type @study to ask",
        Message::JumpToLatest => "Latest",
        Message::PasteImageError => "Could not attach the pasted image. Try again.",
        Message::PastedImageName => "Pasted image",
        Message::MentionPickerHint => "↑ ↓ to choose · Enter or Tab to insert · Esc to close",
        Message::AskAssistant => "Ask the assistant",
        Message::AttachFiles => "Attach files",
        Message::RemoveAttachment => "Remove attachment",
        Message::SendMessage => "Send message",
        Message::SendingMessage => "Sending…",
        Message::SendMessageError => "Could not send the message. Try again.",
        Message::AnswerSources => "Sources",
        Message::ViewDetails => "View details",
        Message::NothingRead => "Nothing was read from this file.",
        Message::NoTextInPhoto => {
            "Study couldn't find any text in this photo. A sharper photo, or a PDF or PNG of it, usually helps."
        }
        Message::NoSpeechDetected => "No speech detected.",
        Message::FileRemovedFromLibrary => "This file was deleted from the Library.",
        Message::ReadingSwitchedOff => {
            "Reading this kind of file is switched off in Settings › Processing."
        }
        Message::AnswerAuthor => "Study",
        Message::WorkTranscribed => "Transcribed",
        Message::WorkRead => "Read",

        // Sessions: the thread under an attachment
        Message::ReplyInThread => "Reply in thread",
        Message::ThreadTitle => "Thread",
        Message::ThreadComposerPlaceholder => "Add a note on this file, or type @study to ask",
        Message::ThreadLoadError => "Could not load this thread. Try again.",

        // Sessions: recording from the microphone
        Message::StartRecording => "Record audio",
        Message::StopRecording => "Stop and send recording",
        Message::RecordingLive => "Recording",
        Message::RecordingSessionTitle => "Recording",
        Message::RecordingInterrupted => "Unfinished recording",
        Message::ResumeRecording => "Resume",
        Message::SendRecording => "Send",
        Message::DiscardRecording => "Discard",
        Message::RecordingElsewhere => "Another session is recording",
        Message::MicrophoneError => "Could not open the microphone.",
        Message::RecordingFailed => {
            "Recording stopped because of an error. Everything recorded until then is saved."
        }
        Message::RecordingFull => "The recording reached its maximum length and was sent.",
        Message::RecordingSaveError => "Could not save the recording.",

        // Sessions: the job detail panel
        Message::ClosePanel => "Close details",
        Message::FileDetails => "File details",
        Message::OpenOriginal => "Open original",
        Message::DetailResults => "Results",
        Message::DetailNoResults => "Nothing has been read from this file yet.",
        Message::DetailAttempts => "Tries",
        Message::DetailStarted => "Started",
        Message::DetailTook => "Took",
        Message::DetailOutput => "Output",
        Message::CorrectText => "Correct this text",
        Message::CorrectionHint => {
            "Search and answers use your correction. Reading the file again replaces it."
        }
        Message::CorrectionStale => "This text changed meanwhile. Check it and try again.",
        Message::CorrectionError => "Could not save the correction. Try again.",
        Message::DetailPreview => "Preview",

        // Study: material and reviews
        Message::FlashcardsDescription => {
            "Cards made from your sessions, reviewed when they are due."
        }
        Message::DiagramsDescription => {
            "How the ideas of your sessions connect, drawn as a map to move around in."
        }
        Message::LoadingStudy => "Loading study material…",
        Message::StudyLoadError => "Could not load the study material. Try again.",
        Message::ReviewDue => "Review",
        Message::MakeMaterial => "Make",
        Message::MaterialNotMade => "Not made yet",
        Message::UpdateMaterial => "Update",
        Message::MaterialWriteFailed => "Couldn't write",
        Message::MaterialUpToDate => "Up to date",
        Message::MaterialUpdating => "Updating…",
        Message::MaterialUpdateFailed => "Couldn't update · showing the last one",
        Message::MaterialNothingToMake => {
            "Nothing in this project can be made into this yet. Add notes, or files Study can read: Settings › Processing says what each kind of file offers."
        }
        Message::ReviewsByProject => "By project",
        Message::ReviewDueHint => {
            "The cards you are closest to forgetting come first. A review takes a few minutes."
        }
        Message::ReviewNothingHint => {
            "You're all caught up. Cards come back as they come due, and new ones as you make them."
        }
        Message::AllCards => "All cards",
        Message::CardTapToReveal => "Click to see the answer",
        Message::PreviousCard => "Previous card",
        Message::NextCard => "Next card",
        Message::KindFlashcards => "Flashcards",
        Message::KindDiagram => "Diagram",
        Message::WritingMaterial => "Writing…",
        Message::WritingFlashcards => "Writing your flashcards…",
        Message::DrawingDiagram => "Drawing your diagram…",
        Message::WritingMaterialHint => {
            "Study reads every passage of these sessions first, so a long one takes a minute or two. You can leave this page: it carries on, and opens here when it is done."
        }
        Message::DeleteMaterial => "Delete",
        Message::AlertDeleteMaterial => "Delete this material?",
        Message::ConfirmDeleteMaterial => "It is gone for good. This cannot be undone.",
        Message::AlertDeleteCards => "Delete these flashcards?",
        Message::ConfirmDeleteCards => {
            "Every card and its review history go with them. This cannot be undone."
        }
        Message::CopyMaterial => "Copy",
        Message::MaterialCopied => "Copied",
        Message::SaveImage => "Save as image (SVG)",
        Message::SaveForAnki => "Save for Anki",
        Message::MaterialSaved => "Saved",
        Message::UntitledMaterial => "Untitled",
        Message::StartReview => "Review",
        Message::NothingDue => "No cards to review right now.",
        Message::ProgressComingUp => "due in the next 7 days",
        Message::ShowAnswer => "Show answer",
        Message::HideAnswer => "Hide answer",
        Message::BackToFlashcards => "Back to flashcards",
        Message::ReviewKeysHint => {
            "Space or Enter shows the answer; then press 1 to 4 to rate how well you knew it."
        }
        Message::RateAgain => "Again",
        Message::RateHard => "Hard",
        Message::RateGood => "Good",
        Message::RateEasy => "Easy",
        Message::ReviewDone => "Review done. Cards come back when they are due.",
        Message::DiagramZoomIn => "Zoom in",
        Message::DiagramZoomOut => "Zoom out",
        Message::DiagramFit => "Fit to view",
        Message::DiagramActualSize => "Actual size",
        Message::DiagramHint => {
            "Drag or use the arrow keys to move around, Ctrl/Cmd + scroll or + and − to zoom, double-click or F to see it all."
        }
        Message::FlashcardsHint => {
            "Click the card or press Space to turn it over; ← and → move through the set."
        }
        Message::FlashcardsShowAll => "Turn all over",
        Message::FlashcardsHideAll => "Turn all back",
        Message::EditCard => "Edit card",
        Message::CardFront => "Question",
        Message::CardBack => "Answer",
        Message::SaveCard => "Save",
        Message::DeleteCard => "Delete card",
        Message::AlertDeleteCard => "Delete this card?",
        Message::ConfirmDeleteCard => "Its review history goes with it.",
        Message::AddCard => "Add a card",

        // Practice: endless quizzes over a project
        Message::PracticeDescription => "Endless questions from your projects, one at a time.",
        Message::LoadingPractice => "Loading practice…",
        Message::PracticeLoadError => "Could not load your practice. Try again.",
        Message::PracticeNoProjects => {
            "There are no projects yet. Start one in Projects, add your notes and files, then come back for questions."
        }
        Message::DeletePractice => "Delete practice",
        Message::AlertDeletePractice => "Delete this practice?",
        Message::ConfirmDeletePractice => "Every answer and grade in it goes with it.",
        Message::QuestionChoice => "Multiple choice",
        Message::QuestionOpen => "In your own words",
        Message::AnswerPlaceholder => {
            "Write your answer. Enter sends it; Shift+Enter starts a new line."
        }
        Message::SubmitAnswer => "Submit",
        Message::CheckingAnswer => "Checking your answer…",
        Message::WritingQuestion => "Writing the next question…",
        Message::NextQuestion => "Next question",
        Message::AddToFlashcards => "Add to my flashcards",
        Message::AddedToFlashcards => "Added to flashcards",
        Message::ChoiceKeysHint => "Press a choice's letter, or its number, to answer.",
        Message::NextKeysHint => "Press Enter for the next question.",
        Message::VerdictCorrect => "Correct",
        Message::VerdictPartly => "Partly correct",
        Message::VerdictIncorrect => "Not quite",
        Message::ChoiceCorrect => "correct",
        Message::ChoiceIncorrect => "incorrect",
        Message::YourAnswer => "Your answer",
        Message::RightAnswer => "Right answer",
        Message::PracticeResults => "Results",
        Message::PracticeNoResults => {
            "Answered questions show up here, with what was right and why."
        }
        Message::PracticeNothingToAsk => {
            "There's nothing to ask about yet: this project has no notes, and none of its files has been read. Add some, then try again."
        }

        // Pipelines: the jobs page
        Message::PipelinesDescription => {
            "Everything Study does in the background: transcribing recordings, reading files, naming sessions, answering, writing study material and practice questions, and grading answers. Stop anything that is running, or start it again."
        }
        Message::LoadingPipelines => "Loading activity…",
        Message::PipelinesLoadError => "Could not load the activity. Try again.",
        Message::PipelinesEmpty => "Nothing here yet.",
        Message::FilterAll => "All",
        Message::GroupWorking => "Working now",
        Message::GroupUpNext => "Up next",
        Message::GroupAttention => "Needs attention",
        Message::GroupStopped => "Stopped",
        Message::GroupFinished => "Finished",
        Message::OpenMaterial => "Open",
        Message::OpenPractice => "Open practice",
        Message::OpenSession => "Open session",
        Message::StartJob => "Start again",
        Message::StopJob => "Stop",
        Message::RetryJob => "Try again",
        Message::JobActionError => "Could not change this task. Try again.",
        Message::SetupSignIn => "Sign in to ChatGPT",
        Message::SetupAction => "Set up",

        // Jobs: stages, statuses, activities and problems (chosen from `JobKind` and `ErrorKind`)
        Message::StageFetch => "Fetching a link",
        Message::StageTranscription => "Transcription",
        Message::StageVision => "Reading pages",
        Message::StageReading => "Reading",
        Message::StageIndex => "Search index",
        Message::StageEmbed => "Search by meaning",
        Message::StageTitle => "Session title",
        Message::StageReply => "Answer",
        Message::StageArtifact => "Study material",
        Message::StageQuestion => "Practice question",
        Message::StageGrade => "Grading an answer",
        Message::StatusQueued => "Up next",
        Message::StatusWaiting => "Waiting",
        Message::StatusStopped => "Stopped",
        Message::StatusFinished => "Finished",
        Message::StatusFailed => "Failed",
        Message::ActivityListening => "Listening",
        Message::ActivityReading => "Reading the text",
        Message::ActivityWorking => "Working",
        Message::ActivityWriting => "Writing",
        Message::ActivityChecking => "Checking",
        Message::ProblemSignIn => "ChatGPT didn't accept your sign-in. Sign in again in Settings.",
        Message::ProblemConnection => {
            "Couldn't reach the online service. Check your internet connection and try again."
        }
        Message::ProblemBusy => "The online service is busy right now. Try again in a minute.",
        Message::ProblemNotReadable => {
            "Study couldn't read this file. Saving it again as a PDF, PNG, MP3 or M4A usually helps."
        }
        Message::ProblemNotEnough => {
            "This project doesn't hold enough to make this. Add notes or files, then try again."
        }
        Message::ProblemModel => {
            "The model on this computer isn't installed or couldn't start. Install it in Settings; this starts again by itself."
        }
        Message::ProblemSetup => "Something in Settings needs attention before this can run.",
        Message::ProblemGone => "What this was working on has been deleted.",
        Message::ProblemUnknown => {
            "Something went wrong. Try again; if it keeps happening, the details say more."
        }

        // Settings: general
        Message::SettingsGeneral => "General",
        Message::SettingsAi => "AI",
        Message::Language => "Language",
        Message::LanguageDescription => "Choose the language used throughout Study.",
        Message::LanguageMenuSubtitle => "Menus and controls",
        Message::EnglishOwnName => "English",
        Message::EnglishOptionSubtitle => "Use English throughout the app",
        Message::ItalianOwnName => "Italiano",
        Message::ItalianOptionSubtitle => "Use Italian throughout the app",
        Message::Updates => "Updates",
        Message::UpdatesDescription => {
            "Check for a new version of Study. Updates are downloaded only when you choose to install them."
        }
        Message::UpdatesMenuSubtitle => "Version and updates",
        Message::UpdateCheck => "Check for updates",
        Message::UpdateInstall => "Install and restart",
        Message::UpdateChecking => "Checking for updates…",
        Message::UpdateInstalling => "Installing the update and restarting Study…",
        Message::UpdateCurrent => "Study is up to date.",
        Message::UpdateUnavailable => "Updates are available in installed release builds.",
        Message::UpdateFailed => "The update could not be completed. Try again.",
        Message::UpdateReady => {
            "A new version is available. Save your work before installing. Study will restart; background jobs resume automatically."
        }
        Message::UpdateBusy => "Finish recording and wait for pending saves before installing.",
        Message::Appearance => "Appearance",
        Message::AppearanceDescription => "Choose how Study looks on this device.",
        Message::AppearanceMenuSubtitle => "Light and dark themes",
        Message::Light => "Light",
        Message::LightOptionSubtitle => "Bright surfaces for daylight",
        Message::Dark => "Dark",
        Message::DarkOptionSubtitle => "Dim surfaces for focused study",
        Message::TextSize => "Text size",
        Message::TextSizeHint => {
            "Make everything larger or smaller. Ctrl/Cmd + and Ctrl/Cmd − do the same from anywhere."
        }
        Message::LanguagePreview => "How it looks",
        Message::PreviewMenus => "Menus",
        Message::PreviewSizes => "File sizes",
        Message::PreviewTimes => "Times",

        // Settings: AI overview
        Message::AiOverview => "Overview",
        Message::AiOverviewDescription => {
            "Every AI feature at a glance: what it's for, where it runs, and what still needs setting up."
        }
        Message::AiOverviewMenuSubtitle => "What's ready and what isn't",
        Message::AiChecking => "Checking…",
        Message::AiReady => "Ready",
        Message::AiNeedsSignIn => "Needs sign-in",
        Message::AiNeedsDownload => "Not downloaded",
        Message::AiLlmPurpose => {
            "Reads your PDFs and pictures, corrects transcripts, names your sessions, answers @study questions, writes study material and practice questions, and grades your answers."
        }
        Message::AiTranscriptionPurpose => "Turns lectures and voice notes into text.",
        Message::AiSearchPurpose => "Finds passages by meaning, not just exact words.",
        Message::AiSearchPrivate => "Always on this computer",
        Message::AiSetUp => "Set up",
        Message::AiOpen => "Open",
        Message::AiPrivacyNote => {
            "Transcription and search run on this computer, and what they read never leaves it. Everything else goes to your ChatGPT plan, and only what each task needs."
        }

        // Jobs: the card for work waiting on setup
        Message::SetupLlmTitle => "Connect your ChatGPT plan",
        Message::SetupLlmBody => {
            "Study writes diagrams, flashcards and answers with your ChatGPT plan. Sign in once and it covers everything."
        }
        Message::SetupTranscriptionTitle => "Download the transcription model",
        Message::SetupTranscriptionBody => {
            "Recordings turn into text on this computer and never leave it. The model downloads once."
        }
        Message::SetupSearchTitle => "Download the search model",
        Message::SetupSearchBody => {
            "Search by meaning runs on this computer. The model downloads once."
        }
        Message::SetupResumes => "This picks up on its own once it is ready.",

        // Settings: fields the AI sections share
        Message::LoadingSettings => "Loading settings…",
        Message::SettingsSaved => "Settings saved.",
        Message::ModelCopies => "Model copies",
        Message::CountError => "Use a whole number of model copies, from 1 to 4.",
        Message::TestConnection => "Test connection",
        Message::TestingConnection => "Testing connection…",
        Message::ConnectionOk => "Connected. ChatGPT accepted a test request.",
        Message::ConnectionFailed => {
            "ChatGPT did not accept the test. Check that you are signed in and the model names."
        }
        Message::ModelInstalled => "Installed",
        Message::DownloadModel => "Download model",
        Message::DownloadingModel => "Downloading model…",
        Message::ModelDownloadError => {
            "Could not download the model. Check your connection and try again."
        }

        // Settings: transcription
        Message::Transcription => "Transcription",
        Message::TranscriptionDescription => {
            "Study turns lectures and recordings into text on this computer; your ChatGPT plan then corrects what it heard."
        }
        Message::TranscriptionMenuSubtitle => "Speech-to-text on this computer",
        Message::TranscriptionLoadError => "Could not load the transcription settings. Try again.",
        Message::ModelCopiesHint => {
            "Each copy uses about 2 GB of memory and transcribes in parallel."
        }
        Message::LocalModelReady => "The model is downloaded and ready.",
        Message::LocalModelMissing => "The model (about 670 MB) has not been downloaded yet.",

        // Settings: language models
        Message::Llm => "Language models",
        Message::LlmDescription => {
            "Study runs on your ChatGPT plan: sign in, then choose the model for each kind of task."
        }
        Message::LlmMenuSubtitle => "Models for each kind of task",
        Message::LlmLoadError => "Could not load the language model settings. Try again.",
        Message::LlmProviderChatGpt => "Your ChatGPT plan",
        Message::LlmTierTiny => "Quick tasks",
        Message::LlmTierTinySubtitle => {
            "Names your sessions and leaves out small talk before material is written. Pick something fast and cheap."
        }
        Message::LlmTierMedium => "Everyday tasks",
        Message::LlmTierMediumSubtitle => {
            "Reads PDFs and pictures, corrects transcripts, answers @study questions, writes study material and practice questions, and grades answers."
        }
        Message::LlmTierSmart => "Demanding tasks",
        Message::LlmTierSmartSubtitle => {
            "Draws diagrams of whole sessions, where quality matters more than speed."
        }
        Message::LlmModelHint => {
            "Each tier runs on the model recommended for it unless you pick another."
        }
        Message::ModelGpt6Luna => "GPT-6 Luna",
        Message::ModelGpt61Sol => "GPT-6.1 Sol",
        Message::ModelGpt6Astra => "GPT-6 Astra",
        Message::LlmTierTestFailed => "This model did not accept the test request.",
        Message::LlmModels => "Models by task",
        Message::LlmChatGptHint => {
            "Sign in with your ChatGPT account and the language models run on your Plus or Pro plan. Your plan's usage limits apply, shared with ChatGPT itself."
        }
        Message::LlmChatGptSignIn => "Sign in with ChatGPT",
        Message::LlmChatGptWaiting => "Finish signing in in your browser…",
        Message::LlmChatGptUsingPlan => "Using ChatGPT plan",
        Message::LlmChatGptNotSharing => "You are signed in, but Study may not use your plan yet.",
        Message::LlmChatGptAllowPlan => "Allow use of my plan",
        Message::LlmChatGptManageUsage => "Manage usage",
        Message::LlmChatGptSignOut => "Sign out",
        Message::LlmChatGptSignedIn => "Signed in to ChatGPT.",
        Message::LlmChatGptSignedOut => "Signed out of ChatGPT.",
        Message::LlmChatGptSignInNeeded => "Sign in with ChatGPT to use your plan.",
        Message::LlmChatGptSignInCancelled => {
            "The sign-in was cancelled or took too long. Try again."
        }
        Message::LlmChatGptNotEligible => "This ChatGPT account cannot use its plan in other apps.",
        Message::LlmChatGptBrowserDone => "Signed in. You can close this tab and return to Study.",
        Message::LlmChatGptBrowserFailed => {
            "The sign-in did not complete. Return to Study to try again."
        }
        Message::LlmChatGptSignInFailed => "Could not sign in to ChatGPT. Try again.",

        // Settings: this computer
        Message::System => "This computer",
        Message::SystemDescription => {
            "What Study found on this computer, what it measured, and which models it decided to run here."
        }
        Message::SystemMenuSubtitle => "Hardware and measurements",
        Message::SysLoadError => {
            "Could not read the saved measurements. Measure this computer again."
        }
        Message::SysDetected => "Hardware",
        Message::SysMeasured => "Details",
        Message::SysDecided => "Where models run",
        Message::SysCores => "Cores",
        Message::SysMemory => "Memory",
        Message::SysMemoryAvailable => "Available now",
        Message::SysSimd => "Vector instructions",
        Message::SysMatmul => "Matrix speed",
        Message::SysBandwidth => "Memory bandwidth",
        Message::SysMeasuredIn => "Measuring took",
        Message::SysSpare => "Spare for models",
        Message::SysSearch => "Search (multilingual E5)",
        Message::SysTranscription => "Transcription (Parakeet)",
        Message::SysNone => "none",
        Message::SearchModelMissing => "Not installed: search matches words only",
        Message::PlacementNotEnoughMemory => "Not enough memory here",
        Message::PlacementTooSlow => "Too slow on this computer",
        Message::SysNotMeasured => "This computer has not been measured yet.",
        Message::MeasureAgain => "Measure again",
        Message::SysMeasureError => "Could not measure this computer. Try again.",

        // Settings: processing
        Message::Processing => "Processing",
        Message::ProcessingDescription => {
            "What Study does with each kind of file: how it is read, how the text is tidied, what makes it searchable, and which study material you can make from it."
        }
        Message::ProcessingMenuSubtitle => "What runs on each kind of file",
        Message::ProcessingLoadError => "Could not load the processing settings.",
        Message::ProcessingReading => "Reading",
        Message::ProcessingTidying => "Tidying",
        Message::ProcessingSearch => "Search",
        Message::ProcessingMaterial => "Study material",
        Message::ProcessingNotRead => {
            "Nothing reads these files, so nothing else runs. Turn on a reader below."
        }
        Message::ProcessingEveryMaterial => "Every piece of study material",
        Message::ProcessingByKind => "Each kind of file",
        Message::ProcessingSift => "Skip small talk and logistics before writing",
        Message::ProcessingSiftHint => {
            "A fast model drops small talk, logistics and noise before material or practice questions are written, so all of your lectures fit, not a sample."
        }
        Message::NewCardsPerDay => "New flashcards a day",
        Message::NewCardsPerDayHint => {
            "A large new set comes in over several days, so reviews stay manageable. Cards already learned always come back when due."
        }
        Message::SourceAudio => "Recordings and audio",
        Message::SourceVideo => "Videos",
        Message::SourceImage => "Pictures",
        Message::SourcePdf => "PDFs",
        Message::SourceText => "Text files",
        Message::SourceCode => "Code and web files",
        Message::SourceDocument => "Documents",
        Message::SourceSpreadsheet => "Spreadsheets",
        Message::SourceSlides => "Slides",
        Message::SourceArchive => "Archives",
        Message::SourceWeb => "Web pages",
        Message::SourceLink => "Links",
        Message::SourceNote => "Notes",
        Message::SourceOther => "Other files",
        Message::ExtractorTranscription => "Transcription",
        Message::ExtractorVision => "Read pages with AI",
        Message::ExtractorOffice => "Office reader",
        Message::ExtractorWeb => "Web page reader",
        Message::ExtractorText => "Plain text reader",
        Message::RefinerTranscript => "Correct transcripts with AI",
        Message::RefinerWhitespace => "Tidy spacing",

        // Help
        Message::HelpDescription => "How Study works, on one page.",
        Message::HelpCaptureTitle => "Capture",
        Message::HelpCaptureBody => {
            "Start a session in a project for each lecture. Type notes, record with the microphone, and drop or paste files: recordings are transcribed on this computer, and slides, PDFs and photos are read for you."
        }
        Message::HelpAskTitle => "Ask",
        Message::HelpAskBody => {
            "Mention @study in a note to get an answer that cites your own files. Each attached file has a thread beside it for notes and questions about just that file."
        }
        Message::HelpStudyTitle => "Review",
        Message::HelpStudyBody => {
            "To make or update a project's flashcards or diagram, open its page, or the project, and press Make or Update. Each page lists the projects and what was made of its kind from each. Update rewrites it from the project as it is now. Flashcards come back when they are due: the Flashcards page and Home say how many are due today. Edit, add or delete any card."
        }
        Message::HelpPracticeTitle => "Practice",
        Message::HelpPracticeBody => {
            "Practice asks endless questions over the files and notes of a project, one at a time, and grades answers written in your own words, saying what was missing."
        }
        Message::HelpKeysTitle => "Keys",
        Message::HelpKeysBody => {
            "Ctrl/Cmd K searches everything. In a review, Space shows the answer and 1 to 4 rate it. In Practice, a choice's letter answers it and Enter goes on. On a diagram, the arrows move, + and − zoom and F fits it."
        }
        Message::ReplayOnboarding => "Replay the welcome tour",
    }
}
