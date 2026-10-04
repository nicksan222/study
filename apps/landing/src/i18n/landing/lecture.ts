// The sample lecture the landing quotes in several sections: the passage the hero highlights,
// what its three phrases became, and the two transcript lines answers cite. Shared: change it
// with every section that quotes it (Hero, Material, Learn).
import type { Shape } from '../strings';

export const en = {
  passage: {
    label: 'Sample lecture',
    source: 'lecture-mitosis.mp3',
    time: '2:02',
    hint: 'Choose a highlight to see what it became.',
    // The transcript, split around the three phrases a learner highlighted.
    before: '',
    p1: 'Mitosis itself has four phases: prophase, metaphase, anaphase and telophase.',
    mid1: ' ',
    p2: 'Some textbooks add prometaphase between prophase and metaphase',
    mid2: '; I’ll mention it, but we’ll work with four. In prophase ',
    p3: 'the chromatin condenses into visible chromosomes',
    after:
      ', the nucleolus disappears, and the centrosomes move to opposite poles and start building the spindle.',
  },
  became: {
    answer: {
      tab: 'An answer',
      ask: '@study How many phases does mitosis have?',
      text: 'Mitosis has four phases: prophase, metaphase, anaphase and telophase, though some textbooks add prometaphase between the first two.',
      cite: '2:02–3:03',
      more: 'How answers cite their sources',
    },
    question: {
      tab: 'A practice question',
      text: 'The lecture mentions prometaphase but works with four phases of mitosis. Which four, and where would prometaphase fit?',
      grade: 'Correct',
      feedback:
        'Exactly: the four phases in order, and prometaphase fits between prophase and metaphase, when the nuclear envelope breaks down.',
      more: 'How practice works',
    },
    card: {
      tab: 'A flashcard',
      front: 'What happens to the chromatin in prophase?',
      back: 'It condenses into visible chromosomes.',
      ratings: ['Again', 'Hard', 'Good', 'Easy'],
      more: 'How flashcards are scheduled',
    },
  },
  // The two transcript lines, at 2:02 and 3:03; the passage's phrases come from them.
  transcript: [
    'Mitosis itself has four phases: prophase, metaphase, anaphase and telophase. Some textbooks add prometaphase between prophase and metaphase; I’ll mention it, but we’ll work with four.',
    'In prophase the chromatin condenses into visible chromosomes, the nucleolus disappears, and the centrosomes move to opposite poles and start building the spindle.',
  ],
} as const;

export const it: Shape<typeof en> = {
  passage: {
    label: 'Lezione di esempio',
    source: 'lecture-mitosis.mp3',
    time: '2:02',
    hint: 'Scegli un’evidenziazione per vedere cosa è diventata.',
    before: '',
    p1: 'La mitosi vera e propria ha quattro fasi: profase, metafase, anafase e telofase.',
    mid1: ' ',
    p2: 'Alcuni libri aggiungono la prometafase tra profase e metafase',
    mid2: '; la cito, ma lavoreremo con quattro. Nella profase ',
    p3: 'la cromatina si condensa in cromosomi visibili',
    after:
      ', il nucleolo scompare e i centrosomi si spostano ai poli opposti e iniziano a formare il fuso.',
  },
  became: {
    answer: {
      tab: 'Una risposta',
      ask: '@study Quante fasi ha la mitosi?',
      text: 'La mitosi ha quattro fasi: profase, metafase, anafase e telofase, anche se alcuni libri aggiungono la prometafase tra le prime due.',
      cite: '2:02–3:03',
      more: 'Come le risposte citano le fonti',
    },
    question: {
      tab: 'Una domanda di esercizio',
      text: 'La lezione cita la prometafase ma lavora con quattro fasi della mitosi. Quali sono, e dove si collocherebbe la prometafase?',
      grade: 'Corretto',
      feedback:
        'Esatto: le quattro fasi in ordine, e la prometafase si colloca tra profase e metafase, quando l’involucro nucleare si dissolve.',
      more: 'Come funzionano gli esercizi',
    },
    card: {
      tab: 'Una flashcard',
      front: 'Cosa succede alla cromatina nella profase?',
      back: 'Si condensa in cromosomi visibili.',
      ratings: ['Di nuovo', 'Difficile', 'Bene', 'Facile'],
      more: 'Come vengono pianificate le flashcard',
    },
  },
  // The two transcript lines, at 2:02 and 3:03; the passage's phrases come from them.
  transcript: [
    'La mitosi vera e propria ha quattro fasi: profase, metafase, anafase e telofase. Alcuni libri aggiungono la prometafase tra profase e metafase; la cito, ma lavoreremo con quattro.',
    'Nella profase la cromatina si condensa in cromosomi visibili, il nucleolo scompare e i centrosomi si spostano ai poli opposti e iniziano a formare il fuso.',
  ],
};
