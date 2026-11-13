import { textFile, paragraph, table, math } from '#tooling/seed/builders/content';
import { choice, openQuestion } from '#tooling/seed/builders/quiz';
import {
  createProject,
  createSource,
  createPage,
  createFlashcards,
  createQuiz,
  createNote
} from '#tooling/seed/harnesses/index';
import type { SeedHarness } from '#tooling/seed/harnesses/index';

export function createEnvironment(seed: SeedHarness) {
  const project = createProject(seed, {
    name: 'Environmental Science',
    color: 'teal',
    examInDays: 42
  });
  const carbonNotes = createSource(
    project,
    textFile(new URL('../files/carbon-cycle.md', import.meta.url))
  );
  const survey = createSource(
    project,
    textFile(new URL('../files/ecosystem-survey.csv', import.meta.url))
  );
  const energyBudget = createSource(
    project,
    textFile(new URL('../files/energy-budget.json', import.meta.url))
  );
  const review = createPage(project, {
    title: 'Ecosystem systems — revision',
    description:
      'Distinguish stocks from flows, compare observations at equal effort, and connect carbon storage, energy transfer, habitat and water.',
    blocks: [
      paragraph(
        'Distinguish stocks from flows, compare observations at equal effort, and connect carbon storage, energy transfer, habitat and water.'
      ),
      paragraph(
        'What is a carbon stock? An amount of carbon stored within a defined reservoir at a specified time.'
      ),
      paragraph(
        'What is a carbon flux? A transfer of carbon per unit time between defined reservoirs.'
      ),
      paragraph(
        'Why standardise survey effort? Detection depends on time, area and method; unequal effort can distort comparisons of observed richness.'
      ),
      paragraph(
        'Does no observation establish absence? No. Imperfect detection means a species can be present without being observed.'
      )
    ]
  });
  const workbook = createPage(project, {
    title: 'Environmental Science — workshop',
    blocks: [
      paragraph(
        'All plots use equal area and survey duration; compare observed richness while retaining detection uncertainty.'
      ),
      table([
        ['Habitat', 'Observed species'],
        ['Meadow', '14, 17'],
        ['Woodland edge', '21, 19'],
        ['Paved margin', '6, 8']
      ]),
      math('\\Delta C = C_{in} - C_{out}'),
      paragraph(
        'The carbon balance refers to a defined boundary and interval. The survey records observations, not proof of complete species inventories.'
      )
    ]
  });
  const cards = createFlashcards(project, 'Environmental Science — key concepts', [
    [
      'What is a carbon stock?',
      'An amount of carbon stored within a defined reservoir at a specified time.'
    ],
    ['What is a carbon flux?', 'A transfer of carbon per unit time between defined reservoirs.'],
    [
      'Why standardise survey effort?',
      'Detection depends on time, area and method; unequal effort can distort comparisons of observed richness.'
    ],
    [
      'Does no observation establish absence?',
      'No. Imperfect detection means a species can be present without being observed.'
    ]
  ]);
  const quiz = createQuiz(project, 'Environmental Science — practice', [
    choice(
      'Which quantity is a flux?',
      'Carbon transferred per year',
      'Carbon stored at one instant',
      'A flux measures a transfer per unit time.'
    ),
    choice(
      'Which comparison is most interpretable?',
      'Plots surveyed with comparable effort and methods',
      'A ten-minute survey compared directly with a week-long survey',
      'Comparable observation effort helps separate ecological variation from differences in detection.'
    ),
    openQuestion(
      'Explain why a stock and a flux need different units.',
      'A stock is an amount at a time, while a flux is an amount transferred per unit time.',
      'State the reservoir boundary and the time interval.'
    )
  ]);

  createNote(project, {
    title: 'Carbon reservoirs',
    daysAgo: 14,
    exchanges: [
      [
        'Why distinguish a carbon stock from a carbon flux?',
        'A stock measures the amount in a reservoir at a time. A flux measures transfer per unit time, so stock and flux quantities use different units.'
      ]
    ],
    sources: [carbonNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Photosynthesis',
    daysAgo: 13,
    exchanges: [
      [
        'How does photosynthesis affect the carbon cycle?',
        'Photosynthesis transfers carbon from atmospheric carbon dioxide into organic matter. Respiration, decomposition and disturbance can return that carbon.'
      ]
    ],
    sources: [survey],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Energy balance',
    daysAgo: 12,
    exchanges: [
      [
        'What controls the planetary energy budget?',
        'The balance compares absorbed solar energy with outgoing thermal radiation. Changes in reflectivity or atmospheric absorption can alter that balance.'
      ]
    ],
    sources: [energyBudget],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Food webs',
    daysAgo: 11,
    exchanges: [
      [
        'Why is energy transfer between trophic levels limited?',
        'Organisms use much of their intake for metabolism, and not all biomass is consumed or assimilated. Energy available for production therefore declines along many feeding pathways.'
      ]
    ],
    sources: [carbonNotes],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'Biodiversity survey',
    daysAgo: 10,
    exchanges: [
      [
        'What should a field survey record?',
        'Record sampling effort, habitat, location, date and identification uncertainty. Comparable effort is essential when interpreting differences in observed richness.'
      ]
    ],
    sources: [survey],
    pages: [review],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Population growth',
    daysAgo: 9,
    exchanges: [
      [
        'Why does exponential growth not continue indefinitely?',
        'Resource limits, competition, disease and other density-dependent processes can constrain growth. The limiting mechanisms vary by species and context.'
      ]
    ],
    sources: [energyBudget],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'Water cycle',
    daysAgo: 8,
    exchanges: [
      [
        'How can land cover affect runoff?',
        'Vegetation, soil structure and impervious surfaces change interception, infiltration and storage. These changes influence the timing and amount of runoff.'
      ]
    ],
    sources: [carbonNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Disturbance and succession',
    daysAgo: 7,
    exchanges: [
      [
        'Does every ecosystem recover along one fixed pathway?',
        'No. Prior conditions, species pools, disturbance severity and subsequent events influence succession. Alternative states and repeated disturbances may change the trajectory.'
      ]
    ],
    sources: [survey],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Uncertainty in observations',
    daysAgo: 6,
    exchanges: [
      [
        'Why report detection limitations in a species survey?',
        'A missing observation does not prove absence. Detection depends on effort, timing, method and species behaviour, so uncertainty should accompany comparisons.'
      ]
    ],
    sources: [energyBudget],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Systems synthesis',
    daysAgo: 5,
    exchanges: [
      [
        'Connect land use, carbon and biodiversity.',
        'Land-use changes can alter carbon storage, water flows and habitat structure together. Assessing one outcome alone can miss trade-offs across the wider system.'
      ]
    ],
    sources: [carbonNotes],
    pages: [workbook],
    materials: [cards]
  });
}
