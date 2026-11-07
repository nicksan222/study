// The landing's privacy section: where the data stays, the sketch's labels and the three facts.
// Every claim here is what the app does: the database and the two local models (speech-to-text
// and search) are on the learner's computer, and only model work goes to their ChatGPT plan.
import type { Shape } from '../strings';

export const yoursEn = {
  yours: {
    title: 'Yours, on your computer.',
    key: 'your computer',
    lead: 'One database on your computer holds everything you bring. Your material leaves only for your own ChatGPT plan, carrying just what a model needs.',
    sketch: {
      computer: 'your computer',
      library: 'your library',
      plan: ['your', 'ChatGPT plan'],
      out: ['only what', 'a model needs']
    },
    local: {
      title: 'Your library stays here',
      body: 'Your notes, sources and documents live on your computer. You choose the material for each task. Work that needs a model runs on',
      never: 'your ChatGPT plan',
      end: '.'
    },
    plan: {
      title: 'No extra AI bill',
      body: 'It runs on the ChatGPT Plus or Pro plan you already have. No API keys, no subscription to us. Each request carries only what its task needs, like the pages to read or the passages found for your question.'
    },
    open: {
      title: 'Apache 2.0 or MIT',
      body: 'Open source, under the licence you choose. Read the code, build it yourself, send a fix.',
      link: 'The code on GitHub'
    },
    more: 'Privacy and your data'
  }
} as const;

export const yoursIt: Shape<typeof yoursEn> = {
  yours: {
    title: 'Tuo, sul tuo computer.',
    key: 'tuo computer',
    lead: 'Un unico database sul tuo computer tiene tutto ciò che porti. Il tuo materiale esce soltanto verso il tuo piano ChatGPT, con solo ciò che serve a un modello.',
    sketch: {
      computer: 'il tuo computer',
      library: 'la tua libreria',
      plan: ['il tuo piano', 'ChatGPT'],
      out: ['solo ciò che', 'serve a un modello']
    },
    local: {
      title: 'La tua libreria resta qui',
      body: 'Appunti, fonti e documenti vivono sul tuo computer. Scegli tu il materiale per ogni attività. Il lavoro che richiede un modello usa',
      never: 'il tuo piano ChatGPT',
      end: '.'
    },
    plan: {
      title: 'Nessun costo AI in più',
      body: 'Usa il piano ChatGPT Plus o Pro che hai già. Niente chiavi API, nessun abbonamento con noi. Ogni richiesta porta solo ciò che serve al suo compito, come le pagine da leggere o i passaggi trovati per la tua domanda.'
    },
    open: {
      title: 'Apache 2.0 or MIT',
      body: 'Open source, con la licenza che scegli tu. Leggi il codice, compilalo da te, proponi una correzione.',
      link: 'Il codice su GitHub'
    },
    more: 'Privacy e dati'
  }
};
