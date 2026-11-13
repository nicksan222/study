import { textFile, paragraph, table, math } from '#tooling/seed/builders/content';
import { choice, multipleChoice } from '#tooling/seed/builders/quiz';
import {
  createProject,
  createSource,
  createPage,
  createFlashcards,
  createQuiz,
  createNote
} from '#tooling/seed/harnesses/index';
import type { SeedHarness } from '#tooling/seed/harnesses/index';

export function createStatistics(seed: SeedHarness) {
  const project = createProject(seed, { name: 'Statistics', color: 'blue', examInDays: 21 });
  const samplingNotes = createSource(
    project,
    textFile(new URL('../files/sampling-and-uncertainty.txt', import.meta.url))
  );
  const testingNotes = createSource(
    project,
    textFile(new URL('../files/hypothesis-testing.txt', import.meta.url))
  );
  const measurements = createSource(
    project,
    textFile(new URL('../files/measurements.csv', import.meta.url))
  );
  const review = createPage(project, {
    title: 'Statistics — worked revision',
    description:
      'Always state the population, sampling method, estimate, and uncertainty. A confidence interval describes the performance of a procedure across repeated samples.',
    blocks: [
      paragraph(
        'Always state the population, sampling method, estimate, and uncertainty. A confidence interval describes the performance of a procedure across repeated samples.'
      ),
      paragraph(
        'What is a standard error? The standard deviation of the sampling distribution of an estimator.'
      ),
      paragraph(
        'What happens to the standard error when sample size quadruples? For independent observations with fixed variance, it halves because it scales as 1/√n.'
      ),
      paragraph('What is a Type I error? Rejecting a true null hypothesis.'),
      paragraph(
        'What is statistical power? The probability of rejecting the null under a specified alternative.'
      )
    ]
  });
  const workbook = createPage(project, {
    title: 'Statistics — workshop',
    blocks: [
      paragraph('A sample of 100 observations has mean 72 and standard deviation 10.'),
      math('SE = \\frac{s}{\\sqrt{n}} = \\frac{10}{\\sqrt{100}} = 1'),
      table([
        ['Quantity', 'Value'],
        ['Mean', '72'],
        ['Standard error', '1'],
        ['Approximate interval', '70.04 to 73.96']
      ]),
      paragraph('The interpretation depends on the sampling design and model assumptions.')
    ]
  });
  const cards = createFlashcards(project, 'Statistics — key concepts', [
    [
      'What is a standard error?',
      'The standard deviation of the sampling distribution of an estimator.'
    ],
    [
      'What happens to the standard error when sample size quadruples?',
      'For independent observations with fixed variance, it halves because it scales as 1/√n.'
    ],
    ['What is a Type I error?', 'Rejecting a true null hypothesis.'],
    [
      'What is statistical power?',
      'The probability of rejecting the null under a specified alternative.'
    ]
  ]);
  const quiz = createQuiz(project, 'Statistics — practice', [
    choice(
      'Which change reduces the standard error of a mean?',
      'Increasing the sample size',
      'Increasing the population variance',
      'For independent data, the standard error is σ/√n.'
    ),
    choice(
      'What does a small p-value provide?',
      'Evidence against the null model',
      'The probability the null is true',
      'A p-value measures the extremeness of the data conditional on the null model.'
    ),
    multipleChoice(
      'Which details belong in a results report?',
      ['Effect estimate', 'Uncertainty interval'],
      ['Only the significance threshold'],
      'Magnitude and uncertainty help interpret a result beyond a binary decision.'
    )
  ]);

  createNote(project, {
    title: 'Sampling frame',
    daysAgo: 14,
    exchanges: [
      [
        'Can a large volunteer poll replace a probability sample?',
        'A larger volunteer sample may still be biased because participation is associated with the outcome. Sample size improves precision under a sampling model but does not fix systematic exclusion.'
      ]
    ],
    sources: [samplingNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Standard error',
    daysAgo: 13,
    exchanges: [
      [
        'What changes when sample size quadruples?',
        'For independent observations with fixed variance, the standard error of a mean halves because it is proportional to one over the square root of the sample size.'
      ]
    ],
    sources: [testingNotes],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Confidence intervals',
    daysAgo: 12,
    exchanges: [
      [
        'How should I interpret a 95% confidence interval?',
        'The procedure covers the fixed population parameter in about 95% of repeated samples under its assumptions. It does not assign a frequentist probability to the parameter after observing this interval.'
      ]
    ],
    sources: [measurements],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Null models',
    daysAgo: 11,
    exchanges: [
      [
        'What does the null hypothesis describe?',
        'It specifies a reference model, often a parameter value. The test statistic is evaluated against the sampling distribution implied by that model and its assumptions.'
      ]
    ],
    sources: [samplingNotes],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'P-values',
    daysAgo: 10,
    exchanges: [
      [
        'Is p = 0.03 the probability the null is true?',
        'No. It is the probability, under the null model, of a result at least as extreme as the observed statistic. It is not a posterior probability of a hypothesis.'
      ]
    ],
    sources: [testingNotes],
    pages: [review],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Power analysis',
    daysAgo: 9,
    exchanges: [
      [
        'What does power depend on?',
        'Power depends on the specified alternative effect, sample size, variation, test and significance level. A power value is meaningful only with those assumptions stated.'
      ]
    ],
    sources: [measurements],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'Regression residuals',
    daysAgo: 8,
    exchanges: [
      [
        'Why inspect residuals after fitting a regression?',
        'Residual patterns can reveal nonlinearity, changing spread or influential observations. A fitted line alone does not show whether the model assumptions are plausible.'
      ]
    ],
    sources: [samplingNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Multiple comparisons',
    daysAgo: 7,
    exchanges: [
      [
        'Why do many tests create problems?',
        'Even when every null is true, many tests offer many opportunities for false rejection. A prespecified family and an appropriate adjustment can control a relevant error rate.'
      ]
    ],
    sources: [testingNotes],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Effect size',
    daysAgo: 6,
    exchanges: [
      [
        'Can a tiny effect be statistically significant?',
        'Yes. A very large sample can estimate a small effect precisely. Reports should distinguish effect magnitude, uncertainty and practical importance.'
      ]
    ],
    sources: [measurements],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Reporting workshop',
    daysAgo: 5,
    exchanges: [
      [
        'What belongs in a statistical results paragraph?',
        'State the population, design, sample size, effect estimate and uncertainty. Describe the model and limitations rather than reporting only whether a threshold was crossed.'
      ]
    ],
    sources: [samplingNotes],
    pages: [workbook],
    materials: [cards]
  });
}
