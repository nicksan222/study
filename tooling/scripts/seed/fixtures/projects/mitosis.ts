import { plainBlock } from '@study/contracts';

import {
  assetFile,
  document,
  heading,
  paragraph,
  table,
  textFile
} from '#tooling/seed/builders/content';
import { createNote, createPage, createSource } from '#tooling/seed/harnesses/index';
import type { ProjectHarness } from '#tooling/seed/harnesses/scope';

const phases = [
  heading('Dalla metafase all’anafase'),
  paragraph(
    'In metafase i cromosomi si allineano al centro della cellula. In anafase i cromatidi fratelli si separano.'
  )
];

const counts = table([
  ['Fase', 'Vetrino A', 'Vetrino B', 'Vetrino C'],
  ['Interfase', '36', '42', '38'],
  ['Profase', '18', '16', '20'],
  ['Metafase', '12', '14', '9'],
  ['Anafase', '7', '5', '8'],
  ['Telofase', '5', '4', '6']
]);

/** Representative originals can be opened side by side in one subject. */
export function createMitosisMaterials(project: ProjectHarness) {
  const fieldNotes = createSource(
    project,
    textFile(new URL('../files/mitosis/field-notes.txt', import.meta.url))
  );

  createNote(project, {
    title: 'Mitosi · osservazioni al microscopio',
    daysAgo: 2,
    exchanges: [
      [
        'Sul vetrino B ho contato 14 cellule in metafase e 5 in anafase.',
        'In metafase cerca una fila centrale di cromosomi. In anafase cerca due gruppi separati.'
      ]
    ],
    sources: [fieldNotes]
  });
  createPage(project, {
    title: 'Mitosi · ripasso per l’esame',
    description: 'Come riconoscere le fasi della divisione e interpretare i conteggi dei vetrini.',
    blocks: [
      ...phases,
      heading('Confronta i preparati'),
      counts,
      paragraph(
        'I conteggi descrivono questo campione. Per confrontare i vetrini, calcola la quota di cellule in ciascuna fase sul totale dello stesso vetrino.'
      ),
      heading('Verifica la comprensione'),
      paragraph('Come distingueresti metafase e anafase osservando un preparato sconosciuto?')
    ]
  });

  for (const [name, blocks] of [
    ['mitosis.pdf', phases],
    ['division.mp4', phases],
    ['metaphase.png', phases],
    [
      'phases.pptx',
      [
        plainBlock('heading', 'Metafase', { type: 'slide', index: 1 }),
        plainBlock('paragraph', 'I cromosomi si allineano al centro della cellula.', {
          type: 'slide',
          index: 1
        }),
        plainBlock('heading', 'Anafase', { type: 'slide', index: 2 }),
        plainBlock('paragraph', 'I cromatidi fratelli si separano.', { type: 'slide', index: 2 })
      ]
    ],
    ['lecture.mp3', [paragraph('Oggi seguiamo il passaggio dalla metafase alla anafase.')]],
    [
      'laboratory.docx',
      [
        heading('Osservare la mitosi'),
        paragraph('Identifica la fase osservando la posizione dei cromosomi.'),
        heading('Domanda di laboratorio'),
        paragraph('Quale indizio distingue la metafase dalla anafase?'),
        table([
          ['Fase', 'Cellule osservate'],
          ['Metafase', '12'],
          ['Anafase', '7']
        ])
      ]
    ],
    ['counts.csv', [counts]],
    [
      'counts.xlsx',
      [
        heading('Conteggio'),
        counts,
        heading('Preparati'),
        table([
          ['Vetrino', 'Ingrandimento', 'Preparato'],
          ['A', '400×', 'Apice radicale'],
          ['B', '400×', 'Apice radicale'],
          ['C', '400×', 'Apice radicale']
        ])
      ]
    ],
    ['observations.json', [paragraph('Vetrino B-08: 12 cellule in metafase, 7 in anafase.')]],
    [
      'laboratory.md',
      [
        heading('La divisione cellulare'),
        paragraph('In metafase i cromosomi si allineano al centro della cellula.'),
        heading('Come riconoscere l’anafase'),
        paragraph('Osserva due gruppi di cromatidi che si allontanano.'),
        paragraph('Confronta la seconda slide con il video della lezione.'),
        heading('Verifica al microscopio'),
        paragraph('Confronta la posizione dei cromosomi nei due vetrini.'),
        table([
          ['Fase', 'Indizio da cercare'],
          ['Metafase', 'Cromosomi allineati al centro'],
          ['Anafase', 'Due gruppi di cromatidi verso poli opposti']
        ]),
        paragraph('Individua una cellula in metafase.'),
        paragraph('Disegna una cellula in anafase.'),
        paragraph(
          'Se i cromatidi non sono distinguibili, cambia campo prima di classificare la cellula.'
        )
      ]
    ],
    ['laboratory.zip', null],
    ['slide-counts.bin', null]
  ] as const) {
    createSource(
      project,
      assetFile(new URL(`../files/mitosis/${name}`, import.meta.url), blocks && document(blocks))
    );
  }
}
