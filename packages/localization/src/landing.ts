/** Marketing copy for the Notes, Materials and Practice workflows, in both shipped languages. */
const english = {
  quizExample: {
    format: 'Question format',
    kinds: [
      'Single answer',
      'Multiple answers',
      'Written answer',
      'True or false',
      'Fill in the blank',
      'Matching pairs',
      'Put in order'
    ],
    multiplePrompt: 'Which cell parts are involved in storing DNA or controlling exchange?',
    blankReference: 'membrane',
    writtenPrompt: 'Explain why the cell needs a selectively permeable membrane.',
    writtenLabel: 'Your explanation',
    compare: 'Compare your answer with the sample explanation.',
    reference: 'Sample explanation',
    booleanPrompt: 'The cell membrane lets every substance pass freely.',
    true: 'True',
    false: 'False',
    blankPrompt: 'The cell ___ controls what enters and leaves the cell.',
    blankLabel: 'Complete the sentence',
    matchPrompt: 'Match each part of the cell to its role.',
    matchParts: ['Membrane', 'Nucleus'],
    matchRoles: ['Controls exchange', 'Stores DNA'],
    choose: 'Choose a role',
    orderPrompt: 'Put these steps in the order they happen.',
    orderItems: [
      'A substance reaches the membrane',
      'The membrane regulates its passage',
      'The substance enters the cell'
    ],
    moveUp: 'Move up',
    moveDown: 'Move down',
    sampleAnswer:
      'A selectively permeable membrane regulates exchange, keeping the conditions inside the cell suitable for life.',
    correctSequence: 'Arrival → regulated passage → entry.'
  },
  examples: {
    label: 'Interactive example · Sample biology material',
    subject: 'Cell biology',
    notes: 'Notes',
    materials: 'Materials',
    practice: 'Practice',
    noteTitle: 'How cells move things',
    noteDraft: 'The cell membrane controls what enters and leaves the cell.',
    noteDemoHint: 'Changes stay in this example until you reload.',
    source: 'Lecture notes · Cell membranes',
    sourceLocator: 'Sample source · Page 1 · Membrane function',
    sourceText:
      'The selectively permeable membrane regulates exchange between the cell and its environment.',
    question: 'What does selectively permeable mean?',
    ask: 'Show sample answer',
    answer:
      'Some substances can cross the membrane while others cannot. The cell can regulate what enters and leaves.',
    citation: 'Read the cited passage',
    pageTitle: 'Cell membranes & transport',
    pageIntro:
      'The plasma membrane is selectively permeable: it controls what enters and leaves the cell while maintaining the conditions inside.',
    pageHeading: 'Two ways across the membrane',
    passive: 'Passive transport',
    active: 'Active transport',
    passiveBody: 'Moves down the concentration gradient. No ATP required.',
    activeBody: 'Moves against the concentration gradient. Requires energy.',
    refine: 'Show sample refinement',
    refined:
      'Passive transport follows the gradient, like moving downhill. Active transport uses energy to move substances uphill, against the gradient.',
    original: 'Show original',
    flashPrompt: 'What does the cell membrane do?',
    flashAnswer: 'It controls the movement of substances into and out of the cell.',
    reveal: 'Show answer',
    hide: 'Hide answer',
    ratings: ['Again', 'Hard', 'Good', 'Easy'],
    rated: 'Recall rated in this example.',
    reset: 'Try again',
    quizTitle: 'Cell biology · Quick check',
    questionNumber: 'Question 1 of 1',
    quizPrompt: 'Which part controls what enters and leaves the cell?',
    quizChoices: ['The nucleus', 'The cell membrane', 'The mitochondria'],
    submit: 'Check answer',
    correct: 'Correct.',
    incorrect: 'Take another look.',
    explanation:
      'The membrane is selectively permeable, so it regulates exchange with the environment.',
    results: 'Your example result',
    correctAnswer: 'The cell membrane',
    noNetwork: 'Illustrative example. No AI request or account required.'
  },
  home: {
    product: 'Product',
    privacy: 'Your data',
    title: ['Everything you study.', 'In a space that’s yours.'],
    lead: 'Notes, sources, flashcards and practice. A desktop workspace for learning from your own material.',
    download: 'Download Study',
    source: 'View source',
    platforms: 'Free and open source. For macOS, Windows and Linux.',
    screenshot: 'Study showing sample cell biology study notes.',
    caption: 'Study, with sample cell biology material.',
    practiceCaption: 'Practice in Study. Sample cell biology question.',
    featuresTitle: 'From your first note to what you know.',
    productStory: [
      {
        title: 'Give every idea a place.',
        emphasis: '',
        lead: 'Write notes and upload original files to Materials in the same subject.',
        detail: '',
        link: 'Explore notes and sources',
        target: 'docs/notes/'
      },
      {
        title: 'Ask a question. Keep the evidence.',
        emphasis: '',
        lead: 'Ask the notebook assistant about your material and follow citations to their sources.',
        detail: '',
        link: 'Questions and answers',
        target: 'docs/answers/'
      },
      {
        title: 'Make sense of',
        emphasis: 'what you collect.',
        lead: 'Generate study notes in Practice from the sources you choose.',
        detail:
          'Ask for a summary or an explanation, then edit the result and revisit earlier versions.',
        link: 'Explore study notes',
        target: 'docs/pages/'
      },
      {
        title: 'Read it.',
        emphasis: 'Recall it. Know it.',
        lead: 'Create flashcards from the material you choose.',
        detail:
          'Try first, reveal the answer, then rate your recall. Return when cards are due or replay the set.',
        link: 'Explore flashcards',
        target: 'docs/flashcards/'
      }
    ],
    storyCaption: 'Interactive examples with sample biology material. Changes stay in this page.',
    practiceTitle: 'Put your knowledge to work.',
    practiceLead:
      'Create a quiz from your study material and focus on what you need. Review your answers, explanations and saved results.',
    quizFormats: [
      'Single answer',
      'Multiple answers',
      'Written answers',
      'True or false',
      'Fill in the blanks',
      'Matching pairs',
      'Put in order'
    ],
    quizQuestionTitle: 'Think through the question.',
    quizQuestionAlt: 'A sample biology quiz question in Study.',
    quizResultTitle: 'See what to revisit.',
    quizResultAlt: 'Saved sample quiz results showing an answer and explanation.',
    practiceLink: 'Explore practice',
    ownershipTitle: ['Your data.', 'On your computer.'],
    ownershipLead:
      'Your notes, materials and study notes live on your device. Export your work. Keep control of what you create.',
    aiTitle: 'AI with your ChatGPT plan.',
    aiBody:
      'AI tasks use your ChatGPT plan and send the required material through that connection.',
    openTitle: 'Free and open source.',
    openBody: 'Read the code, see how Study works, or help make it better.',
    downloadTitle: 'Download Study.',
    downloadLead: 'Choose your desktop platform. Free and open source.'
  },

  docsScreenshotOpen: 'Open full-resolution screenshot',
  docsOnThisPage: 'On this page',
  docsStepDetails: 'Instructions and details',
  docsNavigation: {
    lead: 'Write notes, upload files in Materials, then generate study notes or practice from the sources you choose. Follow the workflow or jump to the guide you need.',
    sections: {
      start: 'Get started',
      capture: 'Capture material',
      pages: 'Study notes',
      practice: 'Practice',
      reference: 'Reference'
    },
    descriptions: {
      start: 'Install Study and take your first note through to practice.',
      capture: 'Collect notes and sources, ask questions and check the evidence.',
      pages: 'Generate study notes in Practice and revise them in the editor.',
      practice: 'Generate exercises and flashcards from the sources you choose.',
      reference: 'Find saved work, use shortcuts and manage settings, data and background work.'
    }
  },
  heroLead:
    'Write notes and save original files in Materials. Use your sources to generate study notes, flashcards and practice.',
  explore: 'See how it works',
  previewLabels: {
    page: 'Study notes editor, showing a sample about mitosis.',
    source: 'Source reader, showing two passages from a sample mitosis lecture.',
    quiz: 'Practice question about prometaphase, with four answer choices.',
    flashcards: 'Flashcard material preview, showing a question and answer about prophase.',
    caption: 'The app’s actual components, with sample material. Static preview.'
  },
  workflow: {
    title: 'Good notes are only the beginning.',
    key: 'the beginning',
    lead: 'From the first messy thought to the question you finally get right. One connected place for the whole process.',
    steps: [
      {
        title: 'Write it in a notebook.',
        body: 'Write in Notes, put files in Materials and ask about your work from the notebook.',
        link: 'Bring your material',
        target: 'docs/sources/'
      },
      {
        title: 'Generate study notes.',
        body: 'Choose your sources in Practice and say what you want to focus on. Review and edit the generated study notes.',
        link: 'See the transformation',
        target: '#workflow-page'
      },
      {
        title: 'Make it something you remember.',
        body: 'Use notes, materials and study notes to create flashcards and quizzes. Go from reading an explanation to recalling it yourself.',
        link: 'Try the study tools',
        target: '#learn'
      }
    ],
    annotation: 'same ideas, a little clearer',
    note: 'Note · Cell biology',
    inputs: ['My lecture notes', 'slides-mitosis.pdf', 'Prophase summary'],
    transform: 'Generate study notes',
    page: 'Study notes',
    titleSample: 'Making sense of mitosis',
    intro:
      'Mitosis separates duplicated chromosomes into two daughter nuclei. The process has four main phases.',
    heading: 'What happens in prophase?',
    paragraph:
      'Chromatin condenses into visible chromosomes. The nucleolus disappears, and the spindle begins to form.',
    citation: 'Lecture · 3:03',
    revision: 'Refine it. Keep its history.',
    outputs: ['Flashcards', 'Practice'],
    footer: 'Your sources stay connected to what you make.'
  },
  capabilities: {
    title: 'A whole study desk. In one app.',
    key: 'one app',
    lead: 'A place to collect, connect, understand and practise. With the details that make it yours.',
    items: [
      {
        title: 'A notebook for every note',
        body: 'Write and edit directly in your notebook. Study saves your changes automatically.',
        detail: 'Write · Edit · Ask'
      },
      {
        title: 'Study notes you can revise',
        body: 'Generate study notes from your sources in Practice. Edit the results, revisit earlier versions or archive notes you no longer use.',
        detail: 'Generate · Edit · Archive'
      },
      {
        title: 'Answers with a way back',
        body: 'Ask about your material and follow citations to the page or passage behind an answer. Keep the explanation connected to its evidence.',
        detail: 'Ask · Check · Understand'
      },
      {
        title: 'More than multiple choice',
        body: 'Practise with open questions, single and multiple choice, matching, ordering, true or false, and fill in the blanks. Get feedback on your answers.',
        detail: 'Recall · Apply · Explain'
      },
      {
        title: 'Different ways to see an idea',
        body: 'Create flashcards and quizzes for recall. Generate study material from the notes, materials and study notes you choose.',
        detail: 'Flashcards · Quizzes'
      },
      {
        title: 'Room for every subject',
        body: 'Keep related work in projects, find it with search, and follow background work as it happens. English or Italian, light or dark, with your own ChatGPT plan.',
        detail: 'Organize · Find · Make it yours'
      }
    ]
  }
} as const;

type Widen<T> = T extends string
  ? string
  : T extends readonly (infer Item)[]
    ? readonly Widen<Item>[]
    : { [Key in keyof T]: Widen<T[Key]> };

type Copy = Widen<typeof english>;

const italian: Copy = {
  quizExample: {
    format: 'Tipo di domanda',
    kinds: [
      'Una risposta',
      'Più risposte',
      'Risposta scritta',
      'Vero o falso',
      'Testo da completare',
      'Abbinamenti',
      'Ordinamento'
    ],
    multiplePrompt: 'Quali parti della cellula conservano il DNA o controllano gli scambi?',
    blankReference: 'membrana',
    writtenPrompt: 'Spiega perché la cellula ha bisogno di una membrana selettivamente permeabile.',
    writtenLabel: 'La tua spiegazione',
    compare: 'Confronta la tua risposta con la spiegazione di esempio.',
    reference: 'Spiegazione di esempio',
    booleanPrompt: 'La membrana cellulare lascia passare liberamente qualsiasi sostanza.',
    true: 'Vero',
    false: 'Falso',
    blankPrompt: 'La ___ cellulare controlla ciò che entra ed esce dalla cellula.',
    blankLabel: 'Completa la frase',
    matchPrompt: 'Abbina ogni parte della cellula alla sua funzione.',
    matchParts: ['Membrana', 'Nucleo'],
    matchRoles: ['Controlla gli scambi', 'Conserva il DNA'],
    choose: 'Scegli una funzione',
    orderPrompt: 'Metti questi passaggi nell’ordine in cui avvengono.',
    orderItems: [
      'Una sostanza raggiunge la membrana',
      'La membrana ne regola il passaggio',
      'La sostanza entra nella cellula'
    ],
    moveUp: 'Sposta su',
    moveDown: 'Sposta giù',
    sampleAnswer:
      'Una membrana selettivamente permeabile regola gli scambi e mantiene le condizioni interne adatte alla vita della cellula.',
    correctSequence: 'Arrivo → passaggio regolato → ingresso.'
  },
  examples: {
    label: 'Esempio interattivo · Materiale di biologia',
    subject: 'Biologia cellulare',
    notes: 'Note',
    materials: 'Materiali',
    practice: 'Esercitazioni',
    noteTitle: 'Come le cellule trasportano le sostanze',
    noteDraft: 'La membrana cellulare controlla ciò che entra ed esce dalla cellula.',
    noteDemoHint: 'Le modifiche restano nell’esempio fino al prossimo caricamento.',
    source: 'Appunti della lezione · Membrane cellulari',
    sourceLocator: 'Fonte di esempio · Pagina 1 · Funzione della membrana',
    sourceText:
      'La membrana selettivamente permeabile regola gli scambi fra la cellula e l’ambiente.',
    question: 'Che cosa significa selettivamente permeabile?',
    ask: 'Mostra la risposta di esempio',
    answer:
      'Alcune sostanze possono attraversare la membrana, altre no. La cellula può regolare ciò che entra ed esce.',
    citation: 'Leggi il passaggio citato',
    pageTitle: 'Membrane cellulari e trasporto',
    pageIntro:
      'La membrana plasmatica è selettivamente permeabile: controlla ciò che entra ed esce dalla cellula e mantiene le condizioni interne.',
    pageHeading: 'Due modi per attraversare la membrana',
    passive: 'Trasporto passivo',
    active: 'Trasporto attivo',
    passiveBody: 'Segue il gradiente di concentrazione. Non richiede ATP.',
    activeBody: 'Va contro il gradiente di concentrazione. Richiede energia.',
    refine: 'Mostra una revisione di esempio',
    refined:
      'Il trasporto passivo segue il gradiente, come andare in discesa. Il trasporto attivo usa energia per spostare sostanze in salita, contro il gradiente.',
    original: 'Mostra l’originale',
    flashPrompt: 'Che cosa fa la membrana cellulare?',
    flashAnswer: 'Controlla il movimento delle sostanze dentro e fuori dalla cellula.',
    reveal: 'Mostra la risposta',
    hide: 'Nascondi la risposta',
    ratings: ['Ancora', 'Difficile', 'Bene', 'Facile'],
    rated: 'Ricordo valutato in questo esempio.',
    reset: 'Riprova',
    quizTitle: 'Biologia cellulare · Ripasso veloce',
    questionNumber: 'Domanda 1 di 1',
    quizPrompt: 'Quale parte controlla ciò che entra ed esce dalla cellula?',
    quizChoices: ['Il nucleo', 'La membrana cellulare', 'I mitocondri'],
    submit: 'Controlla la risposta',
    correct: 'Corretto.',
    incorrect: 'Ripensaci.',
    explanation: 'La membrana è selettivamente permeabile e regola gli scambi con l’ambiente.',
    results: 'Il risultato dell’esempio',
    correctAnswer: 'La membrana cellulare',
    noNetwork: 'Esempio illustrativo. Nessuna richiesta AI o account necessario.'
  },
  home: {
    product: 'Prodotto',
    privacy: 'I tuoi dati',
    title: ['Tutto ciò che studi.', 'In uno spazio tutto tuo.'],
    lead: 'Appunti, fonti, flashcard ed esercizi. Uno spazio desktop per imparare dal tuo materiale.',
    download: 'Scarica Study',
    source: 'Vedi il codice',
    platforms: 'Gratis e open source. Per macOS, Windows e Linux.',
    screenshot: 'Study con appunti di studio di esempio sulla biologia cellulare.',
    caption: 'Study, con materiale di esempio di biologia cellulare.',
    practiceCaption: 'Esercitazione in Study. Domanda di esempio di biologia cellulare.',
    featuresTitle: 'Dai primi appunti a ciò che sai.',
    productStory: [
      {
        title: 'Un posto per ogni idea.',
        emphasis: '',
        lead: 'Scrivi note e carica i file originali in Materiali nella stessa materia.',
        detail: '',
        link: 'Scopri note e fonti',
        target: 'docs/notes/'
      },
      {
        title: 'Fai una domanda. Ritrova le fonti.',
        emphasis: '',
        lead: 'Fai domande sul tuo materiale all’assistente delle note e segui le citazioni fino alle fonti.',
        detail: '',
        link: 'Domande e risposte',
        target: 'docs/answers/'
      },
      {
        title: 'Dai forma a',
        emphasis: 'ciò che raccogli.',
        lead: 'Genera appunti di studio in Esercitazioni dalle fonti che scegli.',
        detail:
          'Chiedi un riassunto o una spiegazione, poi modifica il risultato e rileggi le versioni precedenti.',
        link: 'Scopri gli appunti di studio',
        target: 'docs/pages/'
      },
      {
        title: 'Leggi.',
        emphasis: 'Ricorda. Impara.',
        lead: 'Crea flashcard dal materiale che scegli.',
        detail:
          'Prova a ricordare, rivela la risposta e valuta come è andata. Riprendi le carte da ripassare o ricomincia il set.',
        link: 'Scopri le flashcard',
        target: 'docs/flashcards/'
      }
    ],
    storyCaption:
      'Esempi interattivi con materiale di biologia. Le modifiche restano in questa pagina.',
    practiceTitle: 'Metti alla prova ciò che sai.',
    practiceLead:
      'Crea un quiz dal tuo materiale di studio e concentrati su ciò che ti serve. Rivedi risposte, spiegazioni e risultati salvati.',
    quizFormats: [
      'Una risposta',
      'Più risposte',
      'Risposte scritte',
      'Vero o falso',
      'Testi da completare',
      'Abbinamenti',
      'Ordinamento'
    ],
    quizQuestionTitle: 'Ragiona sulla domanda.',
    quizQuestionAlt: 'Una domanda di biologia di esempio in Study.',
    quizResultTitle: 'Scopri cosa ripassare.',
    quizResultAlt: 'Risultati salvati di un quiz di esempio con risposta e spiegazione.',
    practiceLink: 'Scopri le esercitazioni',
    ownershipTitle: ['I tuoi dati.', 'Sul tuo computer.'],
    ownershipLead:
      'Note, materiali e appunti di studio risiedono sul tuo dispositivo. Esporta il lavoro. Mantieni il controllo di ciò che crei.',
    aiTitle: 'AI con il tuo piano ChatGPT.',
    aiBody:
      'Le attività AI usano il tuo piano ChatGPT e inviano il materiale necessario tramite quella connessione.',
    openTitle: 'Gratis e open source.',
    openBody: 'Leggi il codice, scopri come funziona Study o contribuisci a migliorarlo.',
    downloadTitle: 'Scarica Study.',
    downloadLead: 'Scegli la tua piattaforma desktop. Gratis e open source.'
  },

  docsScreenshotOpen: 'Apri la schermata a piena risoluzione',
  docsOnThisPage: 'In questa pagina',
  docsStepDetails: 'Istruzioni e dettagli',
  docsNavigation: {
    lead: 'Scrivi note, carica i file in Materiali e genera appunti di studio o esercitazioni dalle fonti che scegli. Segui il percorso o apri la guida che ti serve.',
    sections: {
      start: 'Per iniziare',
      capture: 'Raccogliere il materiale',
      pages: 'Appunti di studio',
      practice: 'Esercitarsi',
      reference: 'Consultazione'
    },
    descriptions: {
      start: 'Installa Study e porta la prima nota fino alle esercitazioni.',
      capture: 'Raccogli appunti e fonti, fai domande e controlla i passaggi citati.',
      pages: 'Genera appunti di studio in Esercitazioni e rivedili nell’editor.',
      practice: 'Genera esercizi e flashcard dalle fonti che scegli.',
      reference:
        'Ritrova il lavoro, usa le scorciatoie e gestisci impostazioni, dati e attività in corso.'
    }
  },
  heroLead:
    'Scrivi note e salva i file originali in Materiali. Usa le tue fonti per generare appunti di studio, flashcard ed esercitazioni.',
  explore: 'Scopri come funziona',
  previewLabels: {
    page: 'Editor degli appunti di studio, con un esempio sulla mitosi.',
    source: 'Lettore delle fonti, con due passaggi di una lezione di esempio sulla mitosi.',
    quiz: 'Domanda di esercitazione sulla prometafase, con quattro possibili risposte.',
    flashcards: 'Anteprima delle flashcard, con domanda e risposta sulla profase.',
    caption: 'I componenti dell’app, con materiale di esempio. Anteprima statica.'
  },
  workflow: {
    title: 'Gli appunti sono solo l’inizio.',
    key: 'solo l’inizio',
    lead: 'Dal primo pensiero in disordine alla domanda a cui sai finalmente rispondere. Un unico posto per tutto il percorso.',
    steps: [
      {
        title: 'Prendi nota nel quaderno.',
        body: 'Scrivi in Note, carica i file in Materiali e fai domande sul tuo lavoro dal quaderno.',
        link: 'Porta il tuo materiale',
        target: 'docs/sources/'
      },
      {
        title: 'Genera appunti di studio.',
        body: 'Scegli le fonti in Esercitazioni e indica cosa vuoi approfondire. Rivedi e modifica gli appunti di studio generati.',
        link: 'Guarda la trasformazione',
        target: '#workflow-page'
      },
      {
        title: 'Fallo diventare qualcosa che ricordi.',
        body: 'Crea flashcard e quiz da note, materiali e appunti di studio. Passa dal leggere una spiegazione al ricordarla da solo.',
        link: 'Prova gli strumenti',
        target: '#learn'
      }
    ],
    annotation: 'le stesse idee, un po’ più chiare',
    note: 'Nota · Biologia cellulare',
    inputs: ['I miei appunti della lezione', 'slides-mitosis.pdf', 'Riassunto della profase'],
    transform: 'Genera appunti',
    page: 'Appunti di studio',
    titleSample: 'Capire la mitosi',
    intro:
      'La mitosi separa i cromosomi duplicati in due nuclei figli. Il processo comprende quattro fasi principali.',
    heading: 'Cosa succede nella profase?',
    paragraph:
      'La cromatina si condensa in cromosomi visibili. Il nucleolo scompare e inizia a formarsi il fuso.',
    citation: 'Lezione · 3:03',
    revision: 'Miglioralo. Conserva la sua storia.',
    outputs: ['Flashcard', 'Esercizi'],
    footer: 'Le tue fonti restano collegate a ciò che crei.'
  },
  capabilities: {
    title: 'Tutto per studiare. In un’unica app.',
    key: 'un’unica app',
    lead: 'Un posto per raccogliere, collegare, capire ed esercitarti. Con i dettagli che lo rendono tuo.',
    items: [
      {
        title: 'Un quaderno per ogni nota',
        body: 'Scrivi e modifica le note direttamente nel quaderno. Study salva automaticamente le modifiche.',
        detail: 'Scrivi · Modifica · Chiedi'
      },
      {
        title: 'Appunti di studio da rivedere',
        body: 'Genera appunti di studio dalle tue fonti in Esercitazioni. Modifica i risultati, rileggi le versioni precedenti o archivia gli appunti che non usi più.',
        detail: 'Genera · Modifica · Archivia'
      },
      {
        title: 'Risposte che ritrovano le fonti',
        body: 'Fai domande sul tuo materiale e segui le citazioni fino alla pagina o al passaggio da cui viene una risposta. La spiegazione resta legata alle sue fonti.',
        detail: 'Chiedi · Verifica · Comprendi'
      },
      {
        title: 'Molto più della scelta multipla',
        body: 'Esercitati con domande aperte, scelta singola e multipla, abbinamenti, ordinamenti, vero o falso e testi da completare. Ricevi un commento sulle tue risposte.',
        detail: 'Ricorda · Applica · Spiega'
      },
      {
        title: 'Più modi per vedere un’idea',
        body: 'Crea flashcard e quiz per ricordare. Genera materiale di studio dalle note, dai materiali e dagli appunti di studio che scegli.',
        detail: 'Flashcard · Quiz'
      },
      {
        title: 'Spazio per ogni materia',
        body: 'Riunisci il lavoro in progetti, ritrovalo con la ricerca e segui le attività in corso. Italiano o inglese, tema chiaro o scuro, con il tuo piano ChatGPT.',
        detail: 'Organizza · Ritrova · Personalizza'
      }
    ]
  }
};

export const landingCopy = { en: english, it: italian };

export { utilityExampleCopy } from './landing-utility.ts';
