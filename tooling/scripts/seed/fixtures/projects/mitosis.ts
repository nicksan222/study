import { plainBlock } from '@study/contracts';

import { assetFile, document, heading, paragraph, table } from '#tooling/seed/builders/content';
import { createSource } from '#tooling/seed/harnesses/index';
import type { ProjectHarness } from '#tooling/seed/harnesses/scope';

const phases = [
  heading('Dalla metafase all’anafase'),
  paragraph(
    'In metafase i cromosomi si allineano al centro della cellula. In anafase i cromatidi fratelli si separano.'
  )
];

const counts = table([
  ['Fase', 'Cellule'],
  ['Metafase', '12'],
  ['Anafase', '7']
]);

/** Representative originals can be opened side by side in one subject. */
export function createMitosisMaterials(project: ProjectHarness) {
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
        paragraph('Identifica la fase osservando la posizione dei cromosomi.')
      ]
    ],
    ['counts.csv', [counts]],
    ['counts.xlsx', [counts]],
    ['observations.json', [paragraph('Vetrino B-08: 12 cellule in metafase, 7 in anafase.')]],
    [
      'laboratory.md',
      [
        heading('La divisione cellulare'),
        paragraph('In metafase i cromosomi si allineano al centro della cellula.'),
        heading('Come riconoscere l’anafase')
      ]
    ],
    ['laboratory.zip', [paragraph('Conteggio.csv')]],
    ['slide-counts.bin', []]
  ] as const) {
    createSource(
      project,
      assetFile(new URL(`../files/mitosis/${name}`, import.meta.url), document(blocks))
    );
  }
}
