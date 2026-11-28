/** Authored content for isolated examples of the application's presentation components. */
const en = {
  sample: 'Interactive sample · changes stay in this example.',
  source: {
    heading: 'A selective boundary',
    body: 'The plasma membrane controls exchange between the cell and its surroundings. Its phospholipid bilayer limits the passage of charged particles, while channels and carriers allow specific substances through.'
  },
  material: [
    {
      title: 'Cell membranes & transport',
      kind: 'Study notes',
      body: 'The plasma membrane is selectively permeable. Diffusion follows a concentration gradient; active transport requires energy.'
    },
    {
      title: 'Why does the pump need ATP?',
      kind: 'Note',
      body: 'The sodium–potassium pump uses ATP to move sodium and potassium against their concentration gradients.'
    },
    {
      title: 'Cellular respiration',
      kind: 'Study notes',
      body: 'Mitochondria produce most ATP during aerobic respiration. ATP supplies energy for cellular work.'
    }
  ],
  noResults: 'No matching sample material. Try another word.'
};

const it: typeof en = {
  sample: 'Esempio interattivo · le modifiche restano in questo esempio.',
  source: {
    heading: 'Un confine selettivo',
    body: 'La membrana plasmatica controlla gli scambi tra la cellula e l’ambiente. Il doppio strato fosfolipidico limita il passaggio delle particelle cariche, mentre canali e trasportatori lasciano passare sostanze specifiche.'
  },
  material: [
    {
      title: 'Membrane cellulari e trasporto',
      kind: 'Appunti di studio',
      body: 'La membrana plasmatica è selettivamente permeabile. La diffusione segue il gradiente di concentrazione; il trasporto attivo richiede energia.'
    },
    {
      title: 'Perché la pompa richiede ATP?',
      kind: 'Nota',
      body: 'La pompa sodio-potassio usa ATP per spostare sodio e potassio contro i rispettivi gradienti di concentrazione.'
    },
    {
      title: 'Respirazione cellulare',
      kind: 'Appunti di studio',
      body: 'I mitocondri producono gran parte dell’ATP durante la respirazione aerobica. L’ATP fornisce energia al lavoro cellulare.'
    }
  ],
  noResults: 'Nessun materiale corrispondente. Prova un’altra parola.'
};

export const utilityExampleCopy = { en, it };
