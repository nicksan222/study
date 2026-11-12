// The landing's tabbed stage: its heading, then answers, quiz and flashcard.
import type { Shape } from '../strings';

export const learnEn = {
  stage: {
    title: 'One lecture, three ways to learn it.',
    key: 'three ways',
    body: 'Each tab is a piece of the app to try, made from the passage above.',
    label: 'What Study makes of a lecture'
  },
  answers: {
    tab: 'Answers',
    title: 'Answers you can check.',
    body: 'Ask anything about your material. Every answer cites the page, or the exact moment in the recording. Open a citation and the passage lights up where it came from.',
    note: 'your 2:02 highlight, now a cited answer',
    ask: 'How many phases does mitosis have?',
    a1: 'Mitosis has four phases: prophase, metaphase, anaphase and telophase, though some textbooks add prometaphase between the first two',
    a2: '. In prophase the chromatin condenses into chromosomes and the spindle forms',
    a3: '.',
    cites: ['2:02–3:03', '3:03–4:04'],
    tap: 'open a citation',
    citeLabel: 'Show the source of citation',
    shotAlt:
      'Study on a sample course: the cited passage of the mitosis lecture, 2:02 to 3:03, washed in the file’s details.',
    caption: 'In the app, on a sample course: the same passage, washed in the file’s details.',
    more: 'Answers and citations'
  },
  quiz: {
    tab: 'Quizzes',
    title: 'Quizzes that grade you.',
    body: 'Multiple choice and open questions from your own material, marked with feedback that says why.',
    note: 'that textbook aside? now it’s a question',
    question: 'Where do the textbooks that add it put prometaphase?',
    choices: [
      'Before prophase',
      'Between prophase and metaphase',
      'Between metaphase and anaphase',
      'After telophase'
    ],
    hint: 'Press a choice’s letter, or its number, to answer.',
    correct: 'Correct',
    wrong: 'Not quite',
    right:
      'Exactly: it falls between prophase and metaphase, when the nuclear envelope breaks down.',
    miss: 'The lecture puts it between prophase and metaphase, when the nuclear envelope breaks down.',
    shotAlt:
      'Study on a sample course: an open question on mitosis marked Correct, with feedback that says why.',
    caption: 'In the app: an open answer, graded Correct.',
    more: 'How practice works'
  },
  card: {
    tab: 'Flashcards',
    title: 'Flashcards that come back on time.',
    body: 'Rate each answer and the schedule adapts, so you review just before you forget.',
    note: 'and the chromatin? it’s a card now',
    course: 'Cell biology',
    question: 'Question',
    answer: 'Answer',
    show: 'Show answer',
    hide: 'Show question',
    tap: 'flip it',
    next: ['back later today', 'back soon', 'back in a few days', 'back in a while'],
    from: 'from the lecture, at 3:03',
    shotAlt:
      'Study on a sample course: the four rating buttons under a flashcard, with Good picked.',
    caption: 'In the app, on a sample course: the same four ratings, Good picked.',
    more: 'How flashcards are scheduled'
  }
} as const;

/** Which of the quiz's choices is right, the same in every language. */
export const quizAnswer = 1;

export const learnIt: Shape<typeof learnEn> = {
  stage: {
    title: 'Una lezione, tre modi per impararla.',
    key: 'tre modi',
    body: 'Ogni scheda è un pezzo dell’app da provare, fatto dal passaggio qui sopra.',
    label: 'Cosa fa Study di una lezione'
  },
  answers: {
    tab: 'Risposte',
    title: 'Risposte che puoi verificare.',
    body: 'Chiedi qualsiasi cosa sul tuo materiale. Ogni risposta cita la pagina, o il momento esatto della registrazione. Apri una citazione e il passaggio si illumina nel punto da cui viene.',
    note: 'la tua evidenziazione delle 2:02, ora una risposta citata',
    ask: 'Quante fasi ha la mitosi?',
    a1: 'La mitosi ha quattro fasi: profase, metafase, anafase e telofase, anche se alcuni libri aggiungono la prometafase tra le prime due',
    a2: '. Nella profase la cromatina si condensa in cromosomi e si forma il fuso',
    a3: '.',
    cites: ['2:02–3:03', '3:03–4:04'],
    tap: 'apri una citazione',
    citeLabel: 'Mostra la fonte della citazione',
    shotAlt:
      'Study su un corso di esempio: il passaggio citato della lezione di mitosi, dalle 2:02 alle 3:03, evidenziato nei dettagli del file.',
    caption:
      'Nell’app, su un corso di esempio: lo stesso passaggio, evidenziato nei dettagli del file.',
    more: 'Risposte e citazioni'
  },
  quiz: {
    tab: 'Quiz',
    title: 'Quiz che ti correggono.',
    body: 'Domande a scelta multipla e aperte dal tuo materiale, corrette con un commento che spiega il perché.',
    note: 'l’inciso sui libri? ora è una domanda',
    question: 'Dove collocano la prometafase i libri che la aggiungono?',
    choices: [
      'Prima della profase',
      'Tra profase e metafase',
      'Tra metafase e anafase',
      'Dopo la telofase'
    ],
    hint: 'Premi la lettera di una risposta, o il suo numero, per rispondere.',
    correct: 'Corretto',
    wrong: 'Non proprio',
    right: 'Esatto: si colloca tra profase e metafase, quando l’involucro nucleare si dissolve.',
    miss: 'La lezione la colloca tra profase e metafase, quando l’involucro nucleare si dissolve.',
    shotAlt:
      'Study su un corso di esempio: una domanda aperta sulla mitosi segnata Corretto, con un commento che spiega il perché.',
    caption: 'Nell’app: una risposta aperta, segnata Corretto.',
    more: 'Come funzionano le esercitazioni'
  },
  card: {
    tab: 'Flashcard',
    title: 'Flashcard che tornano al momento giusto.',
    body: 'Valuta ogni risposta e il calendario si adatta: ripassi poco prima di dimenticare.',
    note: 'e la cromatina? ora è una flashcard',
    course: 'Biologia cellulare',
    question: 'Domanda',
    answer: 'Risposta',
    show: 'Mostra risposta',
    hide: 'Mostra domanda',
    tap: 'girala',
    next: [
      'torna più tardi oggi',
      'torna presto',
      'torna tra qualche giorno',
      'torna tra un bel po’'
    ],
    from: 'dalla lezione, alle 3:03',
    shotAlt:
      'Study su un corso di esempio: i quattro pulsanti di valutazione sotto una flashcard, con Bene scelto.',
    caption: 'Nell’app, su un corso di esempio: le stesse quattro valutazioni, con Bene scelto.',
    more: 'Come vengono pianificate le flashcard'
  }
};
