/** Marketing copy for the note → page → practice workflow, in both shipped languages. */
const english = {
  docsScreenshotOpen: 'Open full-resolution screenshot',
  docsNavigation: {
    lead: 'Capture ideas and sources in notes, shape them into pages, then practise what you learned. Follow the workflow or jump to the guide you need.',
    sections: {
      start: 'Get started',
      capture: 'Capture material',
      pages: 'Create pages',
      practice: 'Practice',
      reference: 'Reference'
    },
    descriptions: {
      start: 'Install Study and take your first note through to practice.',
      capture: 'Collect notes and sources, ask questions and check the evidence.',
      pages: 'Turn saved notes into pages and refine your study notes.',
      practice: 'Generate exercises and flashcards from the pages you choose.',
      reference: 'Find saved work, use shortcuts and manage settings, data and background work.'
    }
  },
  heroLead:
    'Capture a note. Make sense of it in a page. Turn what you learn into flashcards and practice. All from your own material.',
  explore: 'See how it works',
  previewLabels: {
    page: 'Page reader, showing sample notes about mitosis.',
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
        title: 'Capture it in a note.',
        body: 'Write as you think. Bring your files, record a lecture and ask questions without leaving your notebook.',
        link: 'Bring your material',
        target: 'docs/sources/'
      },
      {
        title: 'Turn it into a page.',
        body: 'Choose the notes and sources that matter. Combine them into a clear page, then summarize, expand, translate or refine it.',
        link: 'See the transformation',
        target: '#workflow-page'
      },
      {
        title: 'Make it something you remember.',
        body: 'Use your notes and pages to create flashcards and quizzes. Go from reading an explanation to recalling it yourself.',
        link: 'Try the study tools',
        target: '#learn'
      }
    ],
    annotation: 'same ideas, a little clearer',
    note: 'Note · Cell biology',
    inputs: ['My lecture notes', 'slides-mitosis.pdf', 'A question about prophase'],
    transform: 'Combine & clarify',
    page: 'Page',
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
        body: 'Notes, attachments, recordings and questions together. Edit your writing, improve it, or revisit an earlier version.',
        detail: 'Write · Record · Ask'
      },
      {
        title: 'Pages you can keep working on',
        body: 'Turn selected note material into a page. Combine pages, clarify a passage, summarize, expand or translate. Export as Markdown or HTML.',
        detail: 'Transform · Merge · Export'
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
        body: 'Create flashcards and quizzes for recall. Generate study material from the notes, sources and pages you choose.',
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
  docsScreenshotOpen: 'Apri la schermata a piena risoluzione',
  docsNavigation: {
    lead: 'Raccogli appunti e fonti nelle note, trasformali in pagine e poi esercitati su ciò che hai imparato. Segui il percorso o apri la guida che ti serve.',
    sections: {
      start: 'Per iniziare',
      capture: 'Raccogliere il materiale',
      pages: 'Creare pagine',
      practice: 'Esercitarsi',
      reference: 'Consultazione'
    },
    descriptions: {
      start: 'Installa Study e porta la prima nota fino alle esercitazioni.',
      capture: 'Raccogli appunti e fonti, fai domande e controlla i passaggi citati.',
      pages: 'Trasforma le note salvate in pagine e rivedi gli appunti di studio.',
      practice: 'Genera esercizi e flashcard dalle pagine che scegli.',
      reference:
        'Ritrova il lavoro, usa le scorciatoie e gestisci impostazioni, dati e attività in corso.'
    }
  },
  heroLead:
    'Raccogli una nota. Trasformala in una pagina chiaro. Crea flashcard ed esercizi da ciò che impari. Tutto a partire dal tuo materiale.',
  explore: 'Scopri come funziona',
  previewLabels: {
    page: 'Lettore di pagine, con appunti di esempio sulla mitosi.',
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
        title: 'Raccogli tutto in una nota.',
        body: 'Scrivi mentre pensi. Aggiungi file, registra una lezione e fai domande senza lasciare il tuo quaderno.',
        link: 'Porta il tuo materiale',
        target: 'docs/sources/'
      },
      {
        title: 'Trasformalo in una pagina.',
        body: 'Scegli gli appunti e le fonti che contano. Riuniscili in una pagina chiaro, poi riassumi, approfondisci, traduci o migliora il testo.',
        link: 'Guarda la trasformazione',
        target: '#workflow-page'
      },
      {
        title: 'Fallo diventare qualcosa che ricordi.',
        body: 'Crea flashcard e quiz dalle tue note e dalle tue pagine. Passa dal leggere una spiegazione al ricordarla da solo.',
        link: 'Prova gli strumenti',
        target: '#learn'
      }
    ],
    annotation: 'le stesse idee, un po’ più chiare',
    note: 'Nota · Biologia cellulare',
    inputs: ['I miei appunti della lezione', 'slides-mitosis.pdf', 'Una domanda sulla profase'],
    transform: 'Unisci e chiarisci',
    page: 'Pagina',
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
        body: 'Appunti, allegati, registrazioni e domande insieme. Modifica ciò che scrivi, miglioralo o torna a una versione precedente.',
        detail: 'Scrivi · Registra · Chiedi'
      },
      {
        title: 'Pagine che crescono con te',
        body: 'Trasforma il materiale scelto da una nota in una pagina. Unisci pagine, chiarisci un passaggio, riassumi, approfondisci o traduci. Esporta in Markdown o HTML.',
        detail: 'Trasforma · Unisci · Esporta'
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
        body: 'Crea flashcard e quiz per ricordare. Genera materiale di studio dalle note, fonti e pagine che scegli.',
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
