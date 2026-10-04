//! Italian copy.

use crate::Message;

pub(super) fn text(message: Message) -> &'static str {
    match message {
        // App and window: menus, shortcuts and the title bar
        Message::AppName => "Study",
        Message::BrandMark => "S",
        Message::CloseWindow => "Chiudi finestra",
        Message::Quit => "Esci da Study",
        Message::ViewMenu => "Vista",
        Message::ZoomIn => "Ingrandisci (Ctrl/Cmd +)",
        Message::ZoomOut => "Riduci (Ctrl/Cmd −)",
        Message::ResetZoom => "Ripristina zoom (Ctrl/Cmd 0)",
        Message::Back => "Indietro",
        Message::Forward => "Avanti",
        Message::ToggleSidebar => "Mostra o nascondi la barra laterale",
        Message::ToggleFullscreen => "Attiva/disattiva schermo intero",

        // Navigation: the sidebar pages
        Message::Home => "Home",
        Message::MediaList => "Libreria",
        Message::Projects => "Progetti",
        Message::Sessions => "Sessioni",
        Message::Flashcards => "Flashcard",
        Message::Diagrams => "Schemi",
        Message::Practice => "Esercitazioni",
        Message::Pipelines => "Attività",
        Message::Settings => "Impostazioni",
        Message::Help => "Aiuto",

        // Shared actions and states, used on more than one page
        Message::Save => "Salva",
        Message::Saving => "Salvataggio…",
        Message::SaveError => "Impossibile salvare la modifica. Riprova.",
        Message::SaveMaterialError => "Impossibile salvare il materiale. Riprova.",
        Message::Cancel => "Annulla",
        Message::Close => "Chiudi",
        Message::Retry => "Riprova",
        Message::GoToSettings => "Apri impostazioni",
        Message::WorkspaceUnavailable => {
            "L'elaborazione in background non è disponibile. Riavvia Study per riprovare."
        }
        Message::CopyText => "Copia testo",
        Message::ActionError => "Non ha funzionato. Riprova.",
        Message::Today => "Oggi",
        Message::Yesterday => "Ieri",
        Message::Now => "ora",
        Message::JustNow => "proprio ora",

        // Search
        Message::Search => "Cerca",
        Message::SearchPlaceholder => "Cerca progetti, sessioni e file…",
        Message::SearchPrompt => {
            "Scrivi per cercare ovunque: nomi, messaggi e ciò che Study ha letto dai tuoi file."
        }
        Message::SearchNoResults => "Nessun risultato.",
        Message::SearchFailed => "La ricerca non è disponibile al momento.",
        Message::SearchKeywordOnly => {
            "Ricerca per significato in preparazione: per ora solo risultati esatti."
        }
        Message::SearchProjects => "Progetti",
        Message::SearchSessions => "Sessioni",
        Message::SearchFiles => "File",
        Message::SearchPassages => "Nei tuoi file",
        Message::SearchMessages => "Messaggi",
        Message::SearchMove => "Sposta",
        Message::SearchOpen => "Apri",
        Message::SearchClose => "Chiudi",
        Message::SearchKeyUp => "↑",
        Message::SearchKeyDown => "↓",
        Message::SearchKeyEnter => "↵",
        Message::SearchKeyEscape => "esc",
        Message::SearchKindProject => "Progetto",
        Message::SearchKindSession => "Sessione",
        Message::SearchKindFile => "File",
        Message::SearchKindPassage => "Passaggio",
        Message::SearchKindMessage => "Messaggio",

        // Startup: the first hardware measurement
        Message::StartupTitle => "Preparazione di Study",
        Message::StartupIntro => {
            "Alla prima apertura, Study misura questo computer per decidere quali modelli può eseguire qui. I risultati vengono conservati, quindi succede una volta sola."
        }
        Message::StartupMeasuring => "Misurazione di questo computer…",
        Message::StartupFailed => {
            "Impossibile completare la misurazione di questo computer. Riprova."
        }
        Message::StartupSkip => "Continua senza misurare",

        // Onboarding: the guided tour
        Message::OnboardingSkip => "Salta",
        Message::OnboardingNext => "Continua",
        Message::OnboardingStart => "Iniziamo",
        Message::OnboardingFinish => "Inizia a studiare",
        Message::OnboardingWelcomeTitle => "Benvenuto in Study",
        Message::OnboardingWelcomeIntro => {
            "Un posto tranquillo per tutto ciò che impari. Porta lezioni, slide e appunti: Study li legge e li trasforma in materiale da ripassare."
        }
        Message::OnboardingCaptureTitle => "Raccogli tutto",
        Message::OnboardingCaptureText => {
            "Appunti, registrazioni, slide e link, raccolti in un progetto per ogni corso."
        }
        Message::OnboardingAskTitle => "Chiedi quando vuoi",
        Message::OnboardingAskText => {
            "Scrivi @study per fare una domanda che cita i tuoi file. Le pagine di studio creano flashcard e schemi da un intero progetto."
        }
        Message::OnboardingReviewTitle => "Ripassa ciò che conta",
        Message::OnboardingReviewText => {
            "Flashcard, schemi e domande di esercitazione dal tuo materiale."
        }
        Message::OnboardingLookTitle => "Fallo tuo",
        Message::OnboardingLookIntro => {
            "Scegli lingua e aspetto. Puoi cambiarli in seguito dalle Impostazioni."
        }
        Message::OnboardingNotesTitle => "Le sessioni sono il tuo quaderno",
        Message::OnboardingNotesIntro => {
            "Scrivi, registra e allega mentre studi. Study trascrive le registrazioni, legge i file e dà un nome a ogni sessione in background."
        }
        Message::OnboardingSampleNote => "Ciclo di Krebs: otto passaggi, dentro i mitocondri.",
        Message::OnboardingSampleFile => "lezione-06.mp3",
        Message::OnboardingSampleQuestion => "@study perché si ferma senza ossigeno?",
        Message::OnboardingSampleAnswer => {
            "L'ossigeno riceve gli elettroni alla fine della catena di trasporto. Senza, il NAD+ si esaurisce e il ciclo si blocca [1]."
        }
        Message::OnboardingNotesHint => "Solo un appunto che menziona @study riceve una risposta.",
        Message::OnboardingAiTitle => "Dove lavora l'IA",
        Message::OnboardingAiIntro => {
            "Study legge, scrive e risponde con il tuo piano ChatGPT. Solo l'ascolto delle registrazioni e la ricerca funzionano qui, in privato, una volta scaricati i loro modelli."
        }
        Message::OnboardingAiDownload => "Scarica ciò che funziona qui",
        Message::OnboardingAiDownloading => "Download dei modelli… può richiedere un po' di tempo.",
        Message::OnboardingAiDownloaded => "Tutto ciò che funziona qui è scaricato.",
        Message::OnboardingAiChatGpt => {
            "Accedi con ChatGPT Plus o Pro: la lettura dei file, il materiale di studio e le risposte usano il tuo piano."
        }
        Message::OnboardingAiChatGptReady => "I modelli linguistici usano il tuo piano ChatGPT.",
        Message::OnboardingAiWaitForModels => {
            "Quando continui, ciò che funziona qui si scarica in background e intanto puoi già studiare."
        }
        Message::OnboardingAiLater => {
            "Puoi cambiare tutto in seguito dalle Impostazioni, alla voce IA."
        }
        Message::OnboardingAiFailed => {
            "Study non è riuscito a misurare questo computer. Puoi scegliere dalle Impostazioni dove eseguire ogni funzione."
        }
        Message::OnboardingReadyTitle => "È tutto pronto",
        Message::OnboardingReadyIntro => {
            "Crea un progetto per ogni corso, avvia una sessione e aggiungi la tua prima lezione."
        }
        Message::OnboardingOpenAiSettings => "Rivedi le impostazioni IA",

        // Home: the dashboard
        Message::GreetingMorning => "Buongiorno",
        Message::GreetingAfternoon => "Buon pomeriggio",
        Message::GreetingEvening => "Buonasera",
        Message::LoadingDashboard => "Caricamento della panoramica…",
        Message::DashboardLoadError => "Impossibile caricare la panoramica. Riprova.",
        Message::TodayDue => "Le flashcard di tutti i progetti da ripassare ora.",
        Message::TodayNothingDue => "Sei in pari",
        Message::TodayPractise => {
            "Nessuna flashcard da ripassare. Qualche domanda aiuta a non dimenticare."
        }
        Message::ReviewNow => "Ripassa ora",
        Message::ContinueTitle => "Riprendi da dove eri rimasto",
        Message::DashboardNoSessions => {
            "Ancora nessuna sessione. Iniziane una per studiare i tuoi file."
        }
        Message::AllCaughtUp => "Tutto in ordine. Niente è in corso e niente richiede attenzione.",
        Message::OpenPipelines => "Apri attività",
        Message::RecentFiles => "File recenti",
        Message::NoFilesYet => {
            "Ancora nessun file. Aggiungi registrazioni, slide o appunti per iniziare."
        }
        Message::OpenLibrary => "Apri libreria",
        Message::OpenInLibrary => "Apri nella Libreria",
        Message::SeeDetails => "Vedi dettagli",
        Message::RunsHere => "Su questo computer",
        Message::NotRecommendedHere => "Sconsigliato qui",
        Message::AddFiles => "Aggiungi file",
        Message::NewProjectAction => "Nuovo progetto",
        Message::NoProjectsYet => {
            "Crea un progetto per ogni corso che segui, poi avvia sessioni e aggiungi file."
        }

        // Library: files, import and preview
        Message::LoadingMedia => "Caricamento dei file…",
        Message::MediaLoadError => "Impossibile caricare i tuoi file. Riprova.",
        Message::NoMediaYet => "Ancora nessun file. Aggiungine uno per iniziare.",
        Message::AllMedia => "Tutti i file",
        Message::SearchMedia => "Cerca file",
        Message::NoMatchingMedia => {
            "Nessun file trovato. Prova un'altra ricerca o un altro progetto."
        }
        Message::MediaActions => "Azioni file",
        Message::UploadMedia => "Aggiungi file",
        Message::DropMediaFiles => "Trascina qui i file",
        Message::DropFilesToAttach => "Trascina qui i file per allegarli",
        Message::UploadMediaHint => "Oppure scegli i file dal computer",
        Message::MediaFile => "File",
        Message::ChooseMediaFile => "Scegli file",
        Message::AssociateWithProject => "Progetto",
        Message::NoProject => "Nessun progetto",
        Message::ImportingMedia => "Importazione del file…",
        Message::MediaPickerError => "Impossibile aprire la selezione file. Riprova.",
        Message::MediaImportError => {
            "Impossibile importare il file. Usa un file non vuoto inferiore a 512 MiB e riprova."
        }
        Message::MediaAssociateError => {
            "Impossibile aggiornare il progetto di questo file. Riprova."
        }
        Message::LoadingPreview => "Caricamento anteprima…",
        Message::OpenMedia => "Apri nell'app predefinita",
        Message::OpenPage => "Apri pagina",
        Message::ReadFromFile => "Cosa è stato letto",
        Message::ShowFromStart => "Mostra il testo precedente",
        Message::MediaOpenError => "Impossibile aprire questo file.",
        Message::DeleteMedia => "Elimina file",
        Message::AlertDeleteMedia => "Eliminare questo file?",
        Message::ConfirmDeleteMedia => {
            "Il file viene rimosso da Study. L'azione non può essere annullata."
        }
        Message::MediaDeleteError => "Impossibile eliminare questo file. Riprova.",

        // Library: notes and links written in the app
        Message::NewNote => "Nuova nota",
        Message::NoteTitle => "Titolo",
        Message::NoteBodyPlaceholder => "Scrivi la tua nota…",
        Message::SaveNote => "Salva nota",
        Message::NoteIncomplete => "Una nota ha bisogno di un titolo e di un testo.",
        Message::AddLink => "Aggiungi link",
        Message::LinkPlaceholder => "https://…",
        Message::AddLinkHint => {
            "Una pagina web viene salvata e letta. L'audio di un video YouTube viene trascritto: serve che sia installato il programma yt-dlp."
        }
        Message::AddingLink => "Download in corso…",
        Message::LinkMissing => "Incolla prima un indirizzo web.",
        Message::MadeSourceError => {
            "Non ha funzionato. Controlla l'indirizzo o, per un video, che yt-dlp sia installato."
        }

        // Projects
        Message::ProjectsSaveError => "Impossibile salvare questo progetto. Riprova.",
        Message::ProjectsDeleteError => "Impossibile eliminare questo progetto. Riprova.",
        Message::NewProject => "Nuovo progetto",
        Message::CreateProject => "Crea progetto",
        Message::RenameProject => "Rinomina progetto",
        Message::DeleteProject => "Elimina progetto",
        Message::AlertDeleteProject => "Eliminare questo progetto?",
        Message::ConfirmDeleteProject => {
            "Le sue sessioni e il materiale di studio vengono eliminati. I file restano nella Libreria."
        }
        Message::ProjectName => "Nome del progetto",
        Message::ProjectNameDescription => {
            "Dai al progetto un nome facile da riconoscere, come quello di un corso."
        }
        Message::ProjectNameError => "Inserisci un nome da 1 a 100 caratteri.",
        Message::ProjectDetailDescription => {
            "Tutto ciò che studi per questo corso: sessioni, file e materiale di studio."
        }
        Message::ProjectEmptyDescription => {
            "Avvia una sessione per prendere appunti e aggiungere file, poi crea flashcard e schemi dalle loro pagine."
        }
        Message::ProjectDetails => "Dettagli del progetto",
        Message::ViewProjectFiles => "Mostra file",
        Message::ExamDay => "Giorno dell'esame",
        Message::ExamDayPlaceholder => "Scegli il giorno",
        Message::ExamDayHint => {
            "La Home e il ripasso delle flashcard mostrano il conto alla rovescia, a partire dall'esame più vicino."
        }
        Message::OpenProjectCards => "Ripassa le flashcard",
        Message::ProjectMaterial => "Materiale di studio",
        Message::OpenProjectQuiz => "Fai il quiz",

        // Sessions: the list and the conversation
        Message::NewSession => "Nuova sessione",
        Message::LoadingSessions => "Caricamento sessioni…",
        Message::SessionsLoadError => "Impossibile caricare le sessioni. Riprova.",
        Message::SessionsSaveError => "Impossibile aggiornare la sessione. Riprova.",
        Message::StartSession => "Inizia una sessione",
        Message::StartSessionDescription => {
            "Le sessioni conservano insieme ciò che invii e ciò che Study ne ricava, come le trascrizioni."
        }
        Message::StartWithRecording => "Registra una lezione",
        Message::StartWithRecordingDescription => "Trascritta su questo computer mentre ascolti.",
        Message::StartWithFiles => "Aggiungi file",
        Message::StartWithFilesDescription => "Slide, PDF, foto o registrazioni, letti per te.",
        Message::StartWithQuestion => "Chiedi a @study",
        Message::StartWithQuestionDescription => "Una risposta che cita i tuoi file.",
        Message::NoProjectsForSessions => "Crea prima un progetto. Ogni sessione appartiene a uno.",
        Message::ChooseProject => "Scegli un progetto",
        Message::GoToProjects => "Vai ai Progetti",
        Message::SessionEmptyHint => {
            "Scrivi appunti, registra o allega file. L'audio viene trascritto automaticamente; scrivi @study per chiedere all'assistente."
        }
        Message::DeleteSession => "Elimina sessione",
        Message::AlertDeleteSession => "Eliminare questa sessione?",
        Message::ConfirmDeleteSession => {
            "I suoi messaggi e il materiale creato qui vengono eliminati. I file allegati restano nella Libreria."
        }
        Message::DeleteMessage => "Elimina",
        Message::AlertDeleteMessage => "Eliminare questo messaggio?",
        Message::ConfirmDeleteMessage => {
            "Risposte, thread e materiale vengono eliminati con esso. I file restano nella Libreria."
        }
        Message::Regenerate => "Rigenera",
        Message::VersionOriginTyped => "Scritta",
        Message::VersionOriginEdited => "Modificata",
        Message::VersionOriginAnswer => "Risposta",
        Message::VersionOriginImproved => "Migliorata",
        Message::VersionOriginSummarized => "Riassunta",
        Message::VersionPrevious => "Versione precedente",
        Message::VersionNext => "Versione successiva",
        Message::VersionSwitcher => "Versioni",
        Message::VersionWriting => "Scrittura…",
        Message::VersionFailed => "Non riuscita",
        Message::VersionNew => "Nuova versione",
        Message::StopVersion => "Ferma la nuova versione",
        Message::VersionWaitingSignIn => "In attesa dell'accesso a ChatGPT",
        Message::VersionSignIn => "Accedi",
        Message::RewriteInstructionHint => "Invio per eseguire",
        Message::AiEdit => "Modifica con IA",
        Message::EditMessage => "Modifica",
        Message::EditMessageHint => "Premi Ctrl+Invio per salvare, Esc per annullare.",
        Message::RewriteImprove => "Migliora",
        Message::RewriteSummarize => "Riassumi",
        Message::RewriteInstruction => "Dì all'assistente cosa cambiare",
        Message::RewriteInstructionPlaceholder => "Rendila più breve…",
        Message::RewriteRun => "Esegui",
        Message::RewriteBusy => "Una versione è ancora in scrittura. Aspetta o fermala prima.",
        Message::RewriteUnavailable => "Al momento non si può riscrivere.",
        Message::EditUnchanged => "Nulla è cambiato, quindi non c'è una nuova versione.",
        Message::RegenerateTitle => "Rigenera il titolo dagli appunti",
        Message::RegeneratingTitle => "Generazione del nuovo titolo…",
        Message::TitleGenerationError => {
            "Impossibile generare il titolo. Controlla le impostazioni del modello linguistico e riprova."
        }
        Message::LoadingMessages => "Caricamento messaggi…",
        Message::MessagesLoadError => "Impossibile caricare questa sessione. Riprova.",
        Message::ComposerPlaceholder => "Scrivi un appunto, o @study per chiedere",
        Message::JumpToLatest => "Vai in fondo",
        Message::PasteImageError => "Impossibile allegare l'immagine incollata. Riprova.",
        Message::PastedImageName => "Immagine incollata",
        Message::MentionPickerHint => {
            "↑ ↓ per scegliere · Invio o Tab per inserire · Esc per chiudere"
        }
        Message::AskAssistant => "Chiedi all'assistente",
        Message::AttachFiles => "Allega file",
        Message::RemoveAttachment => "Rimuovi allegato",
        Message::SendMessage => "Invia messaggio",
        Message::SendingMessage => "Invio in corso…",
        Message::SendMessageError => "Impossibile inviare il messaggio. Riprova.",
        Message::AnswerSources => "Fonti",
        Message::ViewDetails => "Vedi dettagli",
        Message::NothingRead => "Da questo file non è stato letto niente.",
        Message::NoTextInPhoto => {
            "Study non ha trovato testo in questa foto. Di solito aiuta una foto più nitida, o un PDF o PNG della pagina."
        }
        Message::NoSpeechDetected => "Nessun parlato rilevato.",
        Message::FileRemovedFromLibrary => "Questo file è stato eliminato dalla Libreria.",
        Message::ReadingSwitchedOff => {
            "La lettura di questo tipo di file è disattivata in Impostazioni › Elaborazione."
        }
        Message::AnswerAuthor => "Study",
        Message::WorkTranscribed => "Trascritto",
        Message::WorkRead => "Letto",

        // Sessions: the thread under an attachment
        Message::ReplyInThread => "Rispondi nel thread",
        Message::ThreadTitle => "Thread",
        Message::ThreadComposerPlaceholder => "Un appunto, o @study per chiedere",
        Message::ThreadLoadError => "Impossibile caricare questo thread. Riprova.",

        // Sessions: recording from the microphone
        Message::StartRecording => "Registra audio",
        Message::StopRecording => "Interrompi e invia la registrazione",
        Message::RecordingLive => "Registrazione in corso",
        Message::RecordingSessionTitle => "Registrazione",
        Message::RecordingInterrupted => "Registrazione non terminata",
        Message::ResumeRecording => "Riprendi",
        Message::SendRecording => "Invia",
        Message::DiscardRecording => "Elimina",
        Message::RecordingElsewhere => "Un'altra sessione sta registrando",
        Message::MicrophoneError => "Impossibile aprire il microfono.",
        Message::RecordingFailed => {
            "La registrazione si è interrotta per un errore. Quanto registrato finora è salvato."
        }
        Message::RecordingFull => {
            "La registrazione ha raggiunto la durata massima ed è stata inviata."
        }
        Message::RecordingSaveError => "Impossibile salvare la registrazione.",

        // Sessions: the job detail panel
        Message::ClosePanel => "Chiudi dettagli",
        Message::FileDetails => "Dettagli del file",
        Message::OpenOriginal => "Apri originale",
        Message::DetailResults => "Risultati",
        Message::DetailNoResults => "Da questo file non è ancora stato letto nulla.",
        Message::DetailAttempts => "Tentativi",
        Message::DetailStarted => "Avviata",
        Message::DetailTook => "Durata",
        Message::DetailOutput => "Output",
        Message::CorrectText => "Correggi questo testo",
        Message::CorrectionHint => {
            "Ricerca e risposte usano la tua correzione. Rileggere il file la sostituisce."
        }
        Message::CorrectionStale => "Nel frattempo questo testo è cambiato. Controllalo e riprova.",
        Message::CorrectionError => "Impossibile salvare la correzione. Riprova.",
        Message::DetailPreview => "Anteprima",

        // Study: material and reviews
        Message::FlashcardsDescription => {
            "Flashcard create dalle tue sessioni, da ripassare quando scadono."
        }
        Message::DiagramsDescription => {
            "Come si collegano le idee delle tue sessioni, disegnato come una mappa da esplorare."
        }
        Message::LoadingStudy => "Caricamento del materiale di studio…",
        Message::StudyLoadError => "Impossibile caricare il materiale di studio. Riprova.",
        Message::ReviewDue => "Ripasso",
        Message::MakeMaterial => "Crea",
        Message::MaterialNotMade => "Non ancora creato",
        Message::UpdateMaterial => "Aggiorna",
        Message::MaterialWriteFailed => "Scrittura non riuscita",
        Message::MaterialUpToDate => "Aggiornato",
        Message::MaterialUpdating => "Aggiornamento…",
        Message::MaterialUpdateFailed => "Aggiornamento non riuscito · resta l'ultima",
        Message::MaterialNothingToMake => {
            "In questo progetto non c'è ancora nulla da cui crearlo. Aggiungi appunti, o file che Study sa leggere: Impostazioni › Elaborazione indica cosa offre ogni tipo di file."
        }
        Message::ReviewsByProject => "Per progetto",
        Message::ReviewDueHint => {
            "Prima le flashcard che stai per dimenticare. Un ripasso richiede pochi minuti."
        }
        Message::ReviewNothingHint => {
            "Sei in pari. Le flashcard tornano quando è il momento, e quelle nuove man mano che le crei."
        }
        Message::AllCards => "Tutte le flashcard",
        Message::CardTapToReveal => "Clicca per vedere la risposta",
        Message::PreviousCard => "Flashcard precedente",
        Message::NextCard => "Flashcard successiva",
        Message::KindFlashcards => "Flashcard",
        Message::KindDiagram => "Schema",
        Message::WritingMaterial => "Scrittura…",
        Message::WritingFlashcards => "Sto scrivendo le flashcard…",
        Message::DrawingDiagram => "Sto disegnando lo schema…",
        Message::WritingMaterialHint => {
            "Study legge prima ogni passaggio di queste sessioni, quindi per una lunga ci vuole un minuto o due. Puoi lasciare questa pagina: continua da solo, e lo trovi qui quando è pronto."
        }
        Message::DeleteMaterial => "Elimina",
        Message::AlertDeleteMaterial => "Eliminare questo materiale?",
        Message::ConfirmDeleteMaterial => {
            "Viene eliminato definitivamente. L'azione non può essere annullata."
        }
        Message::AlertDeleteCards => "Eliminare queste flashcard?",
        Message::ConfirmDeleteCards => {
            "Ogni flashcard e i suoi ripassi vengono eliminati. L'azione non può essere annullata."
        }
        Message::CopyMaterial => "Copia",
        Message::MaterialCopied => "Copiato",
        Message::SaveImage => "Salva come immagine (SVG)",
        Message::SaveForAnki => "Salva per Anki",
        Message::MaterialSaved => "Salvato",
        Message::UntitledMaterial => "Senza titolo",
        Message::StartReview => "Ripassa",
        Message::NothingDue => "Nessuna flashcard da ripassare adesso.",
        Message::ProgressComingUp => "in scadenza nei prossimi 7 giorni",
        Message::ShowAnswer => "Mostra risposta",
        Message::HideAnswer => "Nascondi risposta",
        Message::BackToFlashcards => "Torna alle flashcard",
        Message::ReviewKeysHint => {
            "Spazio o Invio mostra la risposta; poi premi da 1 a 4 per dire quanto la sapevi."
        }
        Message::RateAgain => "Di nuovo",
        Message::RateHard => "Difficile",
        Message::RateGood => "Bene",
        Message::RateEasy => "Facile",
        Message::ReviewDone => "Ripasso finito. Le flashcard tornano quando è il momento.",
        Message::DiagramZoomIn => "Ingrandisci",
        Message::DiagramZoomOut => "Riduci",
        Message::DiagramFit => "Adatta alla vista",
        Message::DiagramActualSize => "Dimensione reale",
        Message::DiagramHint => {
            "Trascina o usa le frecce per spostarti, Ctrl/Cmd + rotella o + e − per lo zoom, doppio clic o F per vederlo tutto."
        }
        Message::FlashcardsHint => {
            "Fai clic sulla flashcard o premi Spazio per girarla; ← e → scorrono il mazzo."
        }
        Message::FlashcardsShowAll => "Girale tutte",
        Message::FlashcardsHideAll => "Coprile tutte",
        Message::EditCard => "Modifica flashcard",
        Message::CardFront => "Domanda",
        Message::CardBack => "Risposta",
        Message::SaveCard => "Salva",
        Message::DeleteCard => "Elimina flashcard",
        Message::AlertDeleteCard => "Eliminare questa flashcard?",
        Message::ConfirmDeleteCard => "Anche i suoi ripassi vengono eliminati.",
        Message::AddCard => "Aggiungi una flashcard",

        // Practice: endless quizzes over a project
        Message::PracticeDescription => "Domande senza fine dai tuoi progetti, una alla volta.",
        Message::LoadingPractice => "Caricamento delle esercitazioni…",
        Message::PracticeLoadError => "Impossibile caricare le esercitazioni. Riprova.",
        Message::PracticeNoProjects => {
            "Non ci sono ancora progetti. Creane uno in Progetti, aggiungi appunti e file, poi torna per le domande."
        }
        Message::DeletePractice => "Elimina esercitazione",
        Message::AlertDeletePractice => "Eliminare questa esercitazione?",
        Message::ConfirmDeletePractice => {
            "Ogni risposta e valutazione al suo interno viene eliminata."
        }
        Message::QuestionChoice => "Scelta multipla",
        Message::QuestionOpen => "Con parole tue",
        Message::AnswerPlaceholder => {
            "Scrivi la tua risposta. Invio per inviarla; Maiusc+Invio per andare a capo."
        }
        Message::SubmitAnswer => "Invia",
        Message::CheckingAnswer => "Correzione della tua risposta…",
        Message::WritingQuestion => "Scrittura della prossima domanda…",
        Message::NextQuestion => "Prossima domanda",
        Message::AddToFlashcards => "Aggiungi alle mie flashcard",
        Message::AddedToFlashcards => "Aggiunta alle flashcard",
        Message::ChoiceKeysHint => {
            "Premi la lettera di una risposta, o il suo numero, per rispondere."
        }
        Message::NextKeysHint => "Premi Invio per la prossima domanda.",
        Message::VerdictCorrect => "Corretto",
        Message::VerdictPartly => "In parte corretto",
        Message::VerdictIncorrect => "Non proprio",
        Message::ChoiceCorrect => "corretta",
        Message::ChoiceIncorrect => "sbagliata",
        Message::YourAnswer => "La tua risposta",
        Message::RightAnswer => "Risposta giusta",
        Message::PracticeResults => "Risultati",
        Message::PracticeNoResults => {
            "Qui trovi le domande a cui hai risposto, con cosa era giusto e perché."
        }
        Message::PracticeNothingToAsk => {
            "Non c'è ancora niente su cui fare domande: questo progetto non ha appunti e nessuno dei suoi file è stato letto. Aggiungine, poi riprova."
        }

        // Pipelines: the jobs page
        Message::PipelinesDescription => {
            "Tutto ciò che Study fa in background: trascrive le registrazioni, legge i file, dà un nome alle sessioni, risponde, scrive il materiale di studio e le domande di esercitazione e corregge le risposte. Ferma ciò che è in corso o riavvialo."
        }
        Message::LoadingPipelines => "Caricamento delle attività…",
        Message::PipelinesLoadError => "Impossibile caricare le attività. Riprova.",
        Message::PipelinesEmpty => "Ancora niente qui.",
        Message::FilterAll => "Tutte",
        Message::GroupWorking => "In corso",
        Message::GroupUpNext => "In coda",
        Message::GroupAttention => "Da controllare",
        Message::GroupStopped => "Fermate",
        Message::GroupFinished => "Completate",
        Message::OpenMaterial => "Apri",
        Message::OpenPractice => "Apri l'esercitazione",
        Message::OpenSession => "Apri sessione",
        Message::StartJob => "Riavvia",
        Message::StopJob => "Ferma",
        Message::RetryJob => "Riprova",
        Message::JobActionError => "Impossibile modificare questa attività. Riprova.",
        Message::SetupSignIn => "Accedi a ChatGPT",
        Message::SetupAction => "Configura",

        // Jobs: stages, statuses, activities and problems (chosen from `JobKind` and `ErrorKind`)
        Message::StageFetch => "Recupero del link",
        Message::StageTranscription => "Trascrizione",
        Message::StageVision => "Lettura delle pagine",
        Message::StageReading => "Lettura",
        Message::StageIndex => "Indice di ricerca",
        Message::StageEmbed => "Ricerca per significato",
        Message::StageTitle => "Titolo della sessione",
        Message::StageReply => "Risposta",
        Message::StageRewrite => "Riscrittura",
        Message::StageArtifact => "Materiale di studio",
        Message::StageQuestion => "Domanda di esercitazione",
        Message::StageGrade => "Correzione della risposta",
        Message::StatusQueued => "In coda",
        Message::StatusWaiting => "In attesa",
        Message::StatusStopped => "Fermata",
        Message::StatusFinished => "Completata",
        Message::StatusFailed => "Non riuscita",
        Message::ActivityListening => "In ascolto",
        Message::ActivityReading => "Lettura del testo",
        Message::ActivityWorking => "Al lavoro",
        Message::ActivityWriting => "Scrittura",
        Message::ActivityChecking => "Correzione",
        Message::ProblemSignIn => {
            "ChatGPT non ha accettato il tuo accesso. Accedi di nuovo nelle Impostazioni."
        }
        Message::ProblemConnection => {
            "Impossibile raggiungere il servizio online. Controlla la connessione a internet e riprova."
        }
        Message::ProblemBusy => {
            "Il servizio online è occupato in questo momento. Riprova tra un minuto."
        }
        Message::ProblemNotReadable => {
            "Study non è riuscito a leggere questo file. Salvarlo di nuovo come PDF, PNG, MP3 o M4A di solito aiuta."
        }
        Message::ProblemNotEnough => {
            "Questo progetto non basta per crearlo. Aggiungi appunti o file, poi riprova."
        }
        Message::ProblemModel => {
            "Il modello su questo computer non è installato o non è partito. Installalo nelle Impostazioni; poi l'attività riparte da sola."
        }
        Message::ProblemSetup => {
            "Qualcosa nelle Impostazioni richiede attenzione prima che possa partire."
        }
        Message::ProblemGone => "Ciò su cui stava lavorando è stato eliminato.",
        Message::ProblemUnknown => {
            "Qualcosa è andato storto. Riprova; se succede ancora, i dettagli dicono di più."
        }

        // Settings: general
        Message::SettingsGeneral => "Generali",
        Message::SettingsAi => "IA",
        Message::Language => "Lingua",
        Message::LanguageDescription => "Scegli la lingua usata in Study.",
        Message::LanguageMenuSubtitle => "Menu e controlli",
        Message::EnglishOwnName => "English",
        Message::EnglishOptionSubtitle => "Usa l'inglese in tutta l'app",
        Message::ItalianOwnName => "Italiano",
        Message::ItalianOptionSubtitle => "Usa l'italiano in tutta l'app",
        Message::Updates => "Aggiornamenti",
        Message::UpdatesDescription => {
            "Cerca una nuova versione di Study. Gli aggiornamenti vengono scaricati solo quando scegli di installarli."
        }
        Message::UpdatesMenuSubtitle => "Versione e aggiornamenti",
        Message::UpdateCheck => "Cerca aggiornamenti",
        Message::UpdateInstall => "Installa e riavvia",
        Message::UpdateChecking => "Ricerca aggiornamenti…",
        Message::UpdateInstalling => "Installazione aggiornamento e riavvio di Study…",
        Message::UpdateCurrent => "Study è aggiornato.",
        Message::UpdateUnavailable => {
            "Gli aggiornamenti sono disponibili nelle versioni distribuite e installate."
        }
        Message::UpdateFailed => "Impossibile completare l’aggiornamento. Riprova.",
        Message::UpdateReady => {
            "È disponibile una nuova versione. Salva il lavoro prima di installarla. Study si riavvierà; le attività in corso riprenderanno automaticamente."
        }
        Message::UpdateBusy => {
            "Termina la registrazione e attendi il salvataggio prima di installare."
        }
        Message::Appearance => "Aspetto",
        Message::AppearanceDescription => "Scegli l'aspetto di Study su questo dispositivo.",
        Message::AppearanceMenuSubtitle => "Temi chiaro e scuro",
        Message::Light => "Chiaro",
        Message::LightOptionSubtitle => "Superfici chiare per il giorno",
        Message::Dark => "Scuro",
        Message::DarkOptionSubtitle => "Superfici scure per concentrarsi",
        Message::TextSize => "Dimensione del testo",
        Message::TextSizeHint => {
            "Ingrandisci o rimpicciolisci tutto. Ctrl/Cmd + e Ctrl/Cmd − fanno lo stesso da qualsiasi punto."
        }
        Message::LanguagePreview => "Come appare",
        Message::PreviewMenus => "Menu",
        Message::PreviewSizes => "Dimensioni dei file",
        Message::PreviewTimes => "Tempi",

        // Settings: AI overview
        Message::AiOverview => "Panoramica",
        Message::AiOverviewDescription => {
            "Tutte le funzioni di IA a colpo d'occhio: a cosa servono, dove funzionano e cosa resta da configurare."
        }
        Message::AiOverviewMenuSubtitle => "Cosa è pronto e cosa no",
        Message::AiChecking => "Verifica…",
        Message::AiReady => "Pronto",
        Message::AiNeedsSignIn => "Serve l'accesso",
        Message::AiNeedsDownload => "Da scaricare",
        Message::AiLlmPurpose => {
            "Legge PDF e immagini, corregge le trascrizioni, dà un nome alle sessioni, risponde alle domande con @study, scrive il materiale di studio e le domande di esercitazione e valuta le tue risposte."
        }
        Message::AiTranscriptionPurpose => "Trasforma lezioni e note vocali in testo.",
        Message::AiSearchPurpose => "Trova i passaggi per significato, non solo per parole esatte.",
        Message::AiSearchPrivate => "Sempre su questo computer",
        Message::AiSetUp => "Configura",
        Message::AiOpen => "Apri",
        Message::AiPrivacyNote => {
            "Trascrizione e ricerca funzionano su questo computer, e ciò che leggono non lo lascia mai. Il resto passa dal tuo piano ChatGPT, che riceve solo ciò che serve a ogni attività."
        }

        // Jobs: the card for work waiting on setup
        Message::SetupLlmTitle => "Collega il tuo piano ChatGPT",
        Message::SetupLlmBody => {
            "Study scrive diagrammi, flashcard e risposte con il tuo piano ChatGPT. Accedi una volta e vale per tutto."
        }
        Message::SetupTranscriptionTitle => "Scarica il modello di trascrizione",
        Message::SetupTranscriptionBody => {
            "Le registrazioni diventano testo su questo computer, senza mai lasciarlo. Il modello si scarica una volta sola."
        }
        Message::SetupSearchTitle => "Scarica il modello di ricerca",
        Message::SetupSearchBody => {
            "La ricerca per significato funziona su questo computer. Il modello si scarica una volta sola."
        }
        Message::SetupResumes => "Riprende da sola appena è tutto pronto.",

        // Settings: fields the AI sections share
        Message::LoadingSettings => "Caricamento delle impostazioni…",
        Message::SettingsSaved => "Impostazioni salvate.",
        Message::ModelCopies => "Copie del modello",
        Message::CountError => "Usa un numero intero di copie del modello, da 1 a 4.",
        Message::TestConnection => "Prova la connessione",
        Message::TestingConnection => "Prova della connessione…",
        Message::ConnectionOk => "Connesso. ChatGPT ha accettato una richiesta di prova.",
        Message::ConnectionFailed => {
            "ChatGPT non ha accettato la prova. Controlla l'accesso e i nomi dei modelli."
        }
        Message::ModelInstalled => "Installato",
        Message::DownloadModel => "Scarica il modello",
        Message::DownloadingModel => "Download del modello…",
        Message::ModelDownloadError => {
            "Impossibile scaricare il modello. Controlla la connessione e riprova."
        }

        // Settings: transcription
        Message::Transcription => "Trascrizione",
        Message::TranscriptionDescription => {
            "Study trasforma lezioni e registrazioni in testo su questo computer; il tuo piano ChatGPT poi corregge ciò che ha sentito."
        }
        Message::TranscriptionMenuSubtitle => "Riconoscimento vocale su questo computer",
        Message::TranscriptionLoadError => {
            "Impossibile caricare le impostazioni di trascrizione. Riprova."
        }
        Message::ModelCopiesHint => {
            "Ogni copia usa circa 2 GB di memoria e trascrive in parallelo."
        }
        Message::LocalModelReady => "Il modello è scaricato e pronto.",
        Message::LocalModelMissing => "Il modello (circa 670 MB) non è ancora stato scaricato.",

        // Settings: language models
        Message::Llm => "Modelli linguistici",
        Message::LlmDescription => {
            "Study usa il tuo piano ChatGPT: accedi, poi scegli il modello per ogni tipo di attività."
        }
        Message::LlmMenuSubtitle => "Modelli per ogni tipo di attività",
        Message::LlmLoadError => {
            "Impossibile caricare le impostazioni dei modelli linguistici. Riprova."
        }
        Message::LlmProviderChatGpt => "Il tuo piano ChatGPT",
        Message::LlmTierTiny => "Attività rapide",
        Message::LlmTierTinySubtitle => {
            "Dà un nome alle sessioni e toglie le chiacchiere prima di scrivere il materiale. Scegli un modello veloce ed economico."
        }
        Message::LlmTierMedium => "Attività quotidiane",
        Message::LlmTierMediumSubtitle => {
            "Legge PDF e immagini, corregge le trascrizioni, risponde alle domande con @study, scrive il materiale di studio e le domande di esercitazione, e valuta le risposte."
        }
        Message::LlmTierSmart => "Attività impegnative",
        Message::LlmTierSmartSubtitle => {
            "Disegna gli schemi di sessioni intere, dove la qualità conta più della velocità."
        }
        Message::LlmModelHint => {
            "Ogni livello usa il proprio modello consigliato, a meno che tu non ne scelga un altro."
        }
        Message::ModelGpt6Luna => "GPT-6 Luna",
        Message::ModelGpt61Sol => "GPT-6.1 Sol",
        Message::ModelGpt6Astra => "GPT-6 Astra",
        Message::LlmTierTestFailed => "Questo modello non ha accettato la richiesta di prova.",
        Message::LlmModels => "Modelli per attività",
        Message::LlmChatGptHint => {
            "Accedi con il tuo account ChatGPT e i modelli linguistici useranno il tuo piano Plus o Pro. Valgono i limiti di utilizzo del piano, condivisi con ChatGPT."
        }
        Message::LlmChatGptSignIn => "Accedi con ChatGPT",
        Message::LlmChatGptWaiting => "Completa l'accesso nel browser…",
        Message::LlmChatGptUsingPlan => "Piano ChatGPT in uso",
        Message::LlmChatGptNotSharing => {
            "Hai eseguito l'accesso, ma Study non può ancora usare il tuo piano."
        }
        Message::LlmChatGptAllowPlan => "Consenti l'uso del mio piano",
        Message::LlmChatGptManageUsage => "Gestisci l'utilizzo",
        Message::LlmChatGptSignOut => "Esci",
        Message::LlmChatGptSignedIn => "Accesso a ChatGPT eseguito.",
        Message::LlmChatGptSignedOut => "Disconnesso da ChatGPT.",
        Message::LlmChatGptSignInNeeded => "Accedi con ChatGPT per usare il tuo piano.",
        Message::LlmChatGptSignInCancelled => {
            "L'accesso è stato annullato o ha richiesto troppo tempo. Riprova."
        }
        Message::LlmChatGptNotEligible => {
            "Questo account ChatGPT non può usare il suo piano in altre app."
        }
        Message::LlmChatGptBrowserDone => {
            "Accesso eseguito. Puoi chiudere questa scheda e tornare a Study."
        }
        Message::LlmChatGptBrowserFailed => {
            "L'accesso non è riuscito. Torna a Study per riprovare."
        }
        Message::LlmChatGptSignInFailed => "Impossibile accedere a ChatGPT. Riprova.",

        // Settings: this computer
        Message::System => "Questo computer",
        Message::SystemDescription => {
            "Cosa ha trovato Study su questo computer, cosa ha misurato e quali modelli ha deciso di eseguire qui."
        }
        Message::SystemMenuSubtitle => "Hardware e misurazioni",
        Message::SysLoadError => {
            "Impossibile leggere le misurazioni salvate. Misura di nuovo questo computer."
        }
        Message::SysDetected => "Hardware",
        Message::SysMeasured => "Dettagli",
        Message::SysDecided => "Dove funzionano i modelli",
        Message::SysCores => "Core",
        Message::SysMemory => "Memoria",
        Message::SysMemoryAvailable => "Disponibile ora",
        Message::SysSimd => "Istruzioni vettoriali",
        Message::SysMatmul => "Velocità matriciale",
        Message::SysBandwidth => "Banda di memoria",
        Message::SysMeasuredIn => "La misurazione è durata",
        Message::SysSpare => "Libera per i modelli",
        Message::SysSearch => "Ricerca (E5 multilingue)",
        Message::SysTranscription => "Trascrizione (Parakeet)",
        Message::SysNone => "nessuno",
        Message::SearchModelMissing => "Non installato: la ricerca trova solo le parole",
        Message::PlacementNotEnoughMemory => "Memoria insufficiente qui",
        Message::PlacementTooSlow => "Troppo lento su questo computer",
        Message::SysNotMeasured => "Questo computer non è ancora stato misurato.",
        Message::MeasureAgain => "Misura di nuovo",
        Message::SysMeasureError => "Impossibile misurare questo computer. Riprova.",

        // Settings: processing
        Message::Processing => "Elaborazione",
        Message::ProcessingDescription => {
            "Cosa fa Study con ogni tipo di file: come lo legge, come riordina il testo, cosa lo rende cercabile e quale materiale di studio puoi ricavarne."
        }
        Message::ProcessingMenuSubtitle => "Cosa viene eseguito su ogni tipo di file",
        Message::ProcessingLoadError => "Impossibile caricare le impostazioni di elaborazione.",
        Message::ProcessingReading => "Lettura",
        Message::ProcessingTidying => "Riordino del testo",
        Message::ProcessingSearch => "Ricerca",
        Message::ProcessingMaterial => "Materiale di studio",
        Message::ProcessingNotRead => {
            "Questi file non vengono letti, quindi non viene eseguito nient'altro. Attiva un lettore qui sotto."
        }
        Message::ProcessingEveryMaterial => "Ogni materiale di studio",
        Message::ProcessingByKind => "Ogni tipo di file",
        Message::ProcessingSift => "Salta chiacchiere e questioni organizzative prima di scrivere",
        Message::ProcessingSiftHint => {
            "Un modello veloce elimina chiacchiere, questioni organizzative e rumore prima di scrivere il materiale o le domande di esercitazione, così entrano tutte le lezioni e non solo una parte."
        }
        Message::NewCardsPerDay => "Nuove flashcard al giorno",
        Message::NewCardsPerDayHint => {
            "Un mazzo nuovo e grande viene distribuito su più giorni, così i ripassi restano gestibili. Le flashcard già imparate tornano sempre quando è il momento."
        }
        Message::SourceAudio => "Registrazioni e audio",
        Message::SourceVideo => "Video",
        Message::SourceImage => "Immagini",
        Message::SourcePdf => "PDF",
        Message::SourceText => "File di testo",
        Message::SourceCode => "Codice e file web",
        Message::SourceDocument => "Documenti",
        Message::SourceSpreadsheet => "Fogli di calcolo",
        Message::SourceSlides => "Presentazioni",
        Message::SourceArchive => "Archivi",
        Message::SourceWeb => "Pagine web",
        Message::SourceLink => "Link",
        Message::SourceNote => "Note",
        Message::SourceOther => "Altri file",
        Message::ExtractorTranscription => "Trascrizione",
        Message::ExtractorVision => "Leggi le pagine con l'IA",
        Message::ExtractorOffice => "Lettore Office",
        Message::ExtractorWeb => "Lettore di pagine web",
        Message::ExtractorText => "Lettore di testo semplice",
        Message::RefinerTranscript => "Correggi le trascrizioni con l'IA",
        Message::RefinerWhitespace => "Riordina gli spazi",

        // Help
        Message::HelpDescription => "Come funziona Study, in una pagina.",
        Message::HelpCaptureTitle => "Raccogli",
        Message::HelpCaptureBody => {
            "Avvia una sessione in un progetto per ogni lezione. Scrivi appunti, registra con il microfono e trascina o incolla i file: le registrazioni vengono trascritte su questo computer, e slide, PDF e foto vengono letti per te."
        }
        Message::HelpAskTitle => "Chiedi",
        Message::HelpAskBody => {
            "Scrivi @study in un appunto per avere una risposta che cita i tuoi file. Ogni file allegato ha accanto un thread per appunti e domande solo su quel file."
        }
        Message::HelpStudyTitle => "Ripassa",
        Message::HelpStudyBody => {
            "Per creare o aggiornare le flashcard o il diagramma di un progetto, apri la sua pagina, o il progetto, e premi Crea o Aggiorna. Ogni pagina elenca i progetti e ciò che è stato creato del suo tipo da ciascuno. Aggiorna lo riscrive dal progetto com'è ora. Le flashcard tornano quando è il momento: la pagina Flashcard e la Home dicono quante ne hai da ripassare oggi. Modifica, aggiungi o elimina qualsiasi flashcard."
        }
        Message::HelpPracticeTitle => "Esercitazioni",
        Message::HelpPracticeBody => {
            "Esercitazioni ti fa domande senza fine sui file e sugli appunti di un progetto, una alla volta, e valuta le risposte scritte con parole tue, dicendo cosa mancava."
        }
        Message::HelpKeysTitle => "Tasti",
        Message::HelpKeysBody => {
            "Ctrl/Cmd K cerca ovunque. Nel ripasso, Spazio mostra la risposta e da 1 a 4 la valuti. In Esercitazioni, la lettera di una risposta la sceglie e Invio va avanti. In uno schema, le frecce lo spostano, + e − cambiano lo zoom e F lo adatta alla vista."
        }
        Message::ReplayOnboarding => "Rivedi il tour di benvenuto",
    }
}
