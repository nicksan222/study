import { textFile, paragraph, table } from '#tooling/seed/builders/content';
import { choice, openQuestion } from '#tooling/seed/builders/quiz';
import {
  createProject,
  createSource,
  createPage,
  createFlashcards,
  createQuiz,
  createDiagram,
  createNote
} from '#tooling/seed/harnesses/index';
import type { SeedHarness } from '#tooling/seed/harnesses/index';

export function createHistory(seed: SeedHarness) {
  const project = createProject(seed, {
    name: 'Storia contemporanea',
    color: 'orange',
    examInDays: 28
  });
  const industrialNotes = createSource(
    project,
    textFile(new URL('../files/rivoluzione-industriale.txt', import.meta.url))
  );
  const europeNotes = createSource(
    project,
    textFile(new URL('../files/europa-ottocento.txt', import.meta.url))
  );
  const timeline = createSource(
    project,
    textFile(new URL('../files/timeline.json', import.meta.url))
  );
  const review = createPage(project, {
    title: 'Ottocento — mappa per il ripasso',
    description:
      'Distinguere trasformazioni economiche, conflitti sociali e progetti politici. Collegare industrializzazione, urbanizzazione e richieste di rappresentanza senza ridurle a una sola causa.',
    blocks: [
      paragraph(
        'Distinguere trasformazioni economiche, conflitti sociali e progetti politici. Collegare industrializzazione, urbanizzazione e richieste di rappresentanza senza ridurle a una sola causa.'
      ),
      paragraph(
        'Che cosa si intende per urbanizzazione? L’aumento della popolazione che vive nelle città e la trasformazione delle loro funzioni economiche e sociali.'
      ),
      paragraph(
        'Quale ruolo ebbe il carbone? Fornì energia alle macchine a vapore e alla siderurgia, favorendo la concentrazione industriale.'
      ),
      paragraph(
        'Quale ordine cercò di costruire il Congresso di Vienna? Un equilibrio tra potenze fondato sulla restaurazione dinastica e sul contenimento di nuove egemonie.'
      ),
      paragraph(
        'Perché il 1848 è chiamato primavera dei popoli? Per la diffusione contemporanea di rivolte costituzionali, democratiche e nazionali in molte regioni europee.'
      )
    ]
  });
  const workbook = createPage(project, {
    title: 'Storia contemporanea — workshop',
    blocks: [
      paragraph('Confrontare gli obiettivi dei diversi movimenti senza considerarli sinonimi.'),
      table([
        ['Movimento', 'Obiettivo centrale'],
        ['Liberale', 'Limiti costituzionali al potere'],
        ['Democratico', 'Partecipazione politica più ampia'],
        ['Nazionale', 'Autonomia o unificazione']
      ]),
      paragraph('Collegare ogni affermazione a un attore, un luogo e un momento specifici.')
    ]
  });
  const cards = createFlashcards(project, 'Storia contemporanea — key concepts', [
    [
      'Che cosa si intende per urbanizzazione?',
      'L’aumento della popolazione che vive nelle città e la trasformazione delle loro funzioni economiche e sociali.'
    ],
    [
      'Quale ruolo ebbe il carbone?',
      'Fornì energia alle macchine a vapore e alla siderurgia, favorendo la concentrazione industriale.'
    ],
    [
      'Quale ordine cercò di costruire il Congresso di Vienna?',
      'Un equilibrio tra potenze fondato sulla restaurazione dinastica e sul contenimento di nuove egemonie.'
    ],
    [
      'Perché il 1848 è chiamato primavera dei popoli?',
      'Per la diffusione contemporanea di rivolte costituzionali, democratiche e nazionali in molte regioni europee.'
    ]
  ]);
  const quiz = createQuiz(project, 'Storia contemporanea — practice', [
    choice(
      'Quale settore guidò la prima industrializzazione britannica?',
      'Il tessile cotoniero',
      'L’elettronica',
      'Il cotone fu centrale nella prima meccanizzazione, prima dell’elettrificazione.'
    ),
    choice(
      'Quale congresso ridisegnò l’Europa dopo Napoleone?',
      'Il Congresso di Vienna',
      'Il Congresso di Berlino del 1878',
      'Il Congresso di Vienna si svolse nel 1814–1815 e ridefinì l’equilibrio europeo.'
    ),
    openQuestion(
      'Distinguere liberalismo, democrazia e nazionalismo.',
      'Limiti costituzionali, ampiezza della partecipazione e autonomia nazionale sono questioni differenti che possono intrecciarsi.',
      'Collegare le definizioni ad attori e contesti concreti.'
    )
  ]);
  const overview = createDiagram(
    project,
    'Storia contemporanea — overview',
    'flowchart LR\nIndustrializzazione --> Urbanizzazione\nRestaurazione --> Liberalismo --> Rivoluzioni\nUrbanizzazione --> Conflitti_sociali'
  );

  createNote(project, {
    title: 'Restaurazione',
    daysAgo: 14,
    exchanges: [
      [
        'Quale obiettivo perseguì il Congresso di Vienna?',
        'Le potenze cercarono un equilibrio europeo dopo Napoleone, combinando restaurazione dinastica, interessi territoriali e contenimento di nuove egemonie.'
      ]
    ],
    sources: [industrialNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Fabbrica e lavoro',
    daysAgo: 13,
    exchanges: [
      [
        'Perché la fabbrica trasformò il lavoro?',
        'La concentrazione di macchine e lavoratori modificò ritmi, controllo e organizzazione della produzione, pur convivendo a lungo con altre forme di lavoro.'
      ]
    ],
    sources: [europeNotes],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Carbone e vapore',
    daysAgo: 12,
    exchanges: [
      [
        'Quale collegamento esiste tra carbone e industrializzazione?',
        'Il carbone alimentò macchine a vapore e siderurgia. Energia, materiali e trasporti si rafforzarono reciprocamente senza svilupparsi ovunque allo stesso ritmo.'
      ]
    ],
    sources: [timeline],
    pages: [review],
    materials: [overview]
  });
  createNote(project, {
    title: 'Urbanizzazione',
    daysAgo: 11,
    exchanges: [
      [
        'Quali problemi accompagnarono la crescita delle città?',
        'Alle opportunità di lavoro si affiancarono sovraffollamento, inquinamento e servizi insufficienti. Le risposte amministrative e sanitarie furono graduali e diseguali.'
      ]
    ],
    sources: [industrialNotes],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'Liberalismo e democrazia',
    daysAgo: 10,
    exchanges: [
      [
        'Liberalismo e democrazia sono sinonimi?',
        'No. I liberali chiedevano limiti al potere e garanzie costituzionali, ma non tutti sostenevano il suffragio universale. I democratici proponevano una partecipazione più ampia.'
      ]
    ],
    sources: [europeNotes],
    pages: [review],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Le rivoluzioni del 1830',
    daysAgo: 9,
    exchanges: [
      [
        'Che cosa mostrarono le rivolte del 1830?',
        'Mostrarono la fragilità dell’ordine restaurato e la forza di richieste costituzionali e nazionali, con esiti differenti nei diversi contesti.'
      ]
    ],
    sources: [timeline],
    pages: [workbook],
    materials: [overview]
  });
  createNote(project, {
    title: 'Il 1848 europeo',
    daysAgo: 8,
    exchanges: [
      [
        'Perché le coalizioni del 1848 si divisero?',
        'Liberali, democratici, lavoratori e movimenti nazionali condividevano alcuni avversari, ma divergevano su rappresentanza, proprietà, lavoro e confini politici.'
      ]
    ],
    sources: [industrialNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Questione nazionale',
    daysAgo: 7,
    exchanges: [
      [
        'Come si collegarono nazione e rappresentanza?',
        'I movimenti nazionali rivendicarono autonomia o unificazione, ma proposero modelli politici diversi. La richiesta nazionale non implicava automaticamente la stessa idea di cittadinanza.'
      ]
    ],
    sources: [europeNotes],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Risorgimento',
    daysAgo: 6,
    exchanges: [
      [
        'Quali attori contribuirono all’unificazione italiana?',
        'Governi, diplomatici, eserciti, volontari e movimenti politici agirono con progetti diversi. Guerre e iniziative diplomatiche si intrecciarono con mobilitazioni dal basso.'
      ]
    ],
    sources: [timeline],
    pages: [review],
    materials: [overview]
  });
  createNote(project, {
    title: 'Confronto delle fonti',
    daysAgo: 5,
    exchanges: [
      [
        'Come confrontare due testimonianze sul 1848?',
        'Occorre ricostruire autore, destinatari, contesto e scopo, distinguendo osservazioni dirette, interpretazioni e silenzi. Il disaccordo va spiegato, non cancellato.'
      ]
    ],
    sources: [industrialNotes],
    pages: [workbook],
    materials: [cards]
  });
}
