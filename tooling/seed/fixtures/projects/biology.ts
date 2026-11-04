import { textFile, paragraph, table, assetFile, document } from '#tooling/seed/builders/content';
import { choice, openQuestion } from '#tooling/seed/builders/quiz';
import {
  createProject,
  createSource,
  createDocument,
  createFlashcards,
  createQuiz,
  createDiagram,
  createConversation
} from '#tooling/seed/harnesses/index';
import type { SeedHarness } from '#tooling/seed/harnesses/index';

export function createBiology(seed: SeedHarness) {
  const project = createProject(seed, { name: 'Cell Biology', color: 'green', examInDays: 14 });
  const biologyNotes = createSource(
    project,
    textFile(new URL('../files/cell-biology.txt', import.meta.url))
  );
  const transportNotes = createSource(
    project,
    textFile(new URL('../files/membrane-transport.txt', import.meta.url))
  );
  const membraneDiagram = createSource(
    project,
    assetFile(
      new URL('../files/membrane.svg', import.meta.url),
      document([
        paragraph(
          'A membrane channel permits selective transport down an electrochemical gradient.'
        )
      ])
    )
  );
  const review = createDocument(project, {
    title: 'Cell biology — exam review',
    description:
      'Compare processes by their energy source and direction of transport. Connect organelle structure to its role in protein production.',
    blocks: [
      paragraph(
        'Compare processes by their energy source and direction of transport. Connect organelle structure to its role in protein production.'
      ),
      paragraph(
        'Where does translation begin? On ribosomes in the cytosol; a signal sequence can direct the complex to the rough endoplasmic reticulum.'
      ),
      paragraph(
        'What does the Golgi apparatus do? It modifies, sorts, and packages proteins and lipids for delivery.'
      ),
      paragraph(
        'What drives simple diffusion? Random molecular motion produces net movement down a concentration gradient.'
      ),
      paragraph(
        'How does primary active transport differ? It couples transport against a gradient directly to an energy source such as ATP hydrolysis.'
      )
    ]
  });
  const workbook = createDocument(project, {
    title: 'Cell Biology — workshop',
    blocks: [
      paragraph('Trace a secreted enzyme and distinguish compartments from transport vesicles.'),
      table([
        ['Stage', 'Main role'],
        ['Rough ER', 'Folding and quality control'],
        ['Golgi', 'Modification and sorting'],
        ['Vesicle', 'Transport between compartments']
      ]),
      paragraph(
        'Check whether each step requires a membrane crossing or preserves a membrane-bound space.'
      )
    ]
  });
  const cards = createFlashcards(project, 'Cell Biology — key concepts', [
    [
      'Where does translation begin?',
      'On ribosomes in the cytosol; a signal sequence can direct the complex to the rough endoplasmic reticulum.'
    ],
    [
      'What does the Golgi apparatus do?',
      'It modifies, sorts, and packages proteins and lipids for delivery.'
    ],
    [
      'What drives simple diffusion?',
      'Random molecular motion produces net movement down a concentration gradient.'
    ],
    [
      'How does primary active transport differ?',
      'It couples transport against a gradient directly to an energy source such as ATP hydrolysis.'
    ]
  ]);
  const quiz = createQuiz(project, 'Cell Biology — practice', [
    choice(
      'Which organelle sorts proteins for secretion?',
      'Golgi apparatus',
      'Lysosome',
      'The Golgi modifies and sorts cargo arriving from the endoplasmic reticulum.'
    ),
    choice(
      'Which process directly requires ATP?',
      'Sodium–potassium pump',
      'Simple diffusion of oxygen',
      'The pump hydrolyses ATP to maintain sodium and potassium gradients.'
    ),
    openQuestion(
      'Trace a secreted protein from translation to export.',
      'Ribosome, rough ER, transport vesicles, Golgi and secretory vesicles connect synthesis to release.',
      'Identify the role of each compartment and the transport steps.'
    )
  ]);
  const overview = createDiagram(
    project,
    'Cell Biology — overview',
    'flowchart LR\nDNA --> RNA --> Ribosome\nRibosome --> ER --> Golgi --> Secretion'
  );

  createConversation(project, {
    title: 'Protein trafficking',
    daysAgo: 14,
    exchanges: [
      [
        'Trace a secreted protein through the cell.',
        'Translation begins on a ribosome. A signal sequence directs the complex to the rough ER; transport vesicles then carry cargo through the Golgi to the cell surface.'
      ]
    ],
    sources: [biologyNotes],
    documents: [review],
    materials: [cards]
  });
  createConversation(project, {
    title: 'Membrane gradients',
    daysAgo: 13,
    exchanges: [
      [
        'Why are ion concentrations different inside and outside a cell?',
        'Selective permeability and energy-dependent pumps maintain gradients. Channels allow selected ions to move down their electrochemical gradients.'
      ]
    ],
    sources: [transportNotes],
    documents: [workbook],
    materials: [quiz]
  });
  createConversation(project, {
    title: 'Osmosis lab',
    daysAgo: 12,
    exchanges: [
      [
        'What happens to an animal cell in a hypotonic solution?',
        'Water moves into the cell down its water-potential gradient. The cell swells and may lyse because it lacks a rigid cell wall.'
      ]
    ],
    sources: [membraneDiagram],
    documents: [review],
    materials: [overview]
  });
  createConversation(project, {
    title: 'ATP synthesis',
    daysAgo: 11,
    exchanges: [
      [
        'How does a proton gradient help make ATP?',
        'Proton movement through ATP synthase couples a downhill electrochemical process to ATP synthesis. The inner mitochondrial membrane separates the two compartments.'
      ]
    ],
    sources: [biologyNotes],
    documents: [workbook],
    materials: [cards]
  });
  createConversation(project, {
    title: 'Cell cycle checkpoints',
    daysAgo: 10,
    exchanges: [
      [
        'What does a checkpoint accomplish?',
        'A checkpoint delays progression when required conditions are not met, such as incomplete replication or damaged DNA. It reduces the chance of passing defects to daughter cells.'
      ]
    ],
    sources: [transportNotes],
    documents: [review],
    materials: [quiz]
  });
  createConversation(project, {
    title: 'Enzyme kinetics',
    daysAgo: 9,
    exchanges: [
      [
        'Does increasing substrate always increase reaction rate?',
        'Rate rises with substrate concentration until enzyme active sites approach saturation. The maximum rate depends on the amount of active enzyme.'
      ]
    ],
    sources: [membraneDiagram],
    documents: [workbook],
    materials: [overview]
  });
  createConversation(project, {
    title: 'Signalling pathways',
    daysAgo: 8,
    exchanges: [
      [
        'How can a small signal produce a large response?',
        'A receptor can activate a cascade in which each step affects many downstream molecules. Feedback and deactivation help control amplification.'
      ]
    ],
    sources: [biologyNotes],
    documents: [review],
    materials: [cards]
  });
  createConversation(project, {
    title: 'Microscopy planning',
    daysAgo: 7,
    exchanges: [
      [
        'How do magnification and resolution differ?',
        'Magnification enlarges an image. Resolution determines whether nearby features can be distinguished; enlarging an unresolved image does not reveal new detail.'
      ]
    ],
    sources: [transportNotes],
    documents: [workbook],
    materials: [quiz]
  });
  createConversation(project, {
    title: 'Transport practice',
    daysAgo: 6,
    exchanges: [
      [
        'Compare a channel with a sodium–potassium pump.',
        'A channel permits selected ions to move down a gradient. The pump hydrolyses ATP to move sodium out and potassium in against their gradients.'
      ]
    ],
    sources: [membraneDiagram],
    documents: [review],
    materials: [overview]
  });
  createConversation(project, {
    title: 'Exam synthesis',
    daysAgo: 5,
    exchanges: [
      [
        'Connect organelle structure with protein secretion.',
        'The rough ER supports entry and folding of secreted proteins. The Golgi modifies and sorts cargo, while vesicles preserve compartment boundaries during transport.'
      ]
    ],
    sources: [biologyNotes],
    documents: [workbook],
    materials: [cards]
  });
}
