import { textFile, paragraph, table, code } from '#tooling/seed/builders/content';
import { choice, multipleChoice } from '#tooling/seed/builders/quiz';
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

export function createComputerScience(seed: SeedHarness) {
  const project = createProject(seed, {
    name: 'Computer Science',
    color: 'violet',
    examInDays: 35
  });
  const relationalNotes = createSource(
    project,
    textFile(new URL('../files/relational-data.md', import.meta.url))
  );
  const indexingQueries = createSource(
    project,
    textFile(new URL('../files/indexing.sql', import.meta.url))
  );
  const transactionExample = createSource(
    project,
    textFile(new URL('../files/transactions.ts', import.meta.url))
  );
  const review = createPage(project, {
    title: 'Relational databases — review',
    description:
      'Model stable identities and relationships, inspect query plans, and protect invariants with constraints and transactions.',
    blocks: [
      paragraph(
        'Model stable identities and relationships, inspect query plans, and protect invariants with constraints and transactions.'
      ),
      paragraph(
        'What is a foreign key? A constraint requiring a reference to an existing parent key, subject to its declared nullability.'
      ),
      paragraph(
        'What does an index trade off? Faster access for suitable queries in exchange for storage and write-maintenance costs.'
      ),
      paragraph(
        'What is atomicity? The related changes of a transaction commit together or are rolled back together.'
      ),
      paragraph(
        'What does a left join preserve? All rows from its left input, including those without a matching right-side row.'
      )
    ]
  });
  const workbook = createPage(project, {
    title: 'Computer Science — workshop',
    blocks: [
      paragraph('List every course, including those with no enrolments.'),
      code(
        'SELECT c.id, COUNT(e.student_id) AS students\nFROM courses c LEFT JOIN enrolments e ON e.course_id = c.id\nGROUP BY c.id;',
        'sql'
      ),
      table([
        ['Query decision', 'Reason'],
        ['LEFT JOIN', 'Retain courses with no enrolments'],
        ['COUNT(e.student_id)', 'Count matched student keys']
      ]),
      paragraph(
        'Check the query plan against representative data rather than assuming every scan is wrong.'
      )
    ]
  });
  const cards = createFlashcards(project, 'Computer Science — key concepts', [
    [
      'What is a foreign key?',
      'A constraint requiring a reference to an existing parent key, subject to its declared nullability.'
    ],
    [
      'What does an index trade off?',
      'Faster access for suitable queries in exchange for storage and write-maintenance costs.'
    ],
    [
      'What is atomicity?',
      'The related changes of a transaction commit together or are rolled back together.'
    ],
    [
      'What does a left join preserve?',
      'All rows from its left input, including those without a matching right-side row.'
    ]
  ]);
  const quiz = createQuiz(project, 'Computer Science — practice', [
    choice(
      'Which table models student enrolment?',
      'A join table containing student and course keys',
      'A comma-separated course list in the student name',
      'A join table represents the many-to-many relationship with independent rows.'
    ),
    choice(
      'What enforces durable uniqueness?',
      'A database unique constraint',
      'A UI-only validation message',
      'A database constraint checks every writer, including concurrent paths.'
    ),
    multipleChoice(
      'Which mechanisms protect database invariants?',
      ['Foreign keys', 'Unique constraints', 'Transactions'],
      ['An editable display label alone'],
      'Constraints and transactions operate at the durable write boundary.'
    )
  ]);
  const overview = createDiagram(
    project,
    'Computer Science — overview',
    'erDiagram\nSTUDENT ||--o{ ENROLMENT : has\nCOURSE ||--o{ ENROLMENT : contains\nSTUDENT {\n int id PK\n}\nCOURSE {\n int id PK\n}\nENROLMENT {\n int student_id FK\n int course_id FK\n}'
  );

  createNote(project, {
    title: 'Relational modelling',
    daysAgo: 14,
    exchanges: [
      [
        'How should I model students and courses?',
        'Use separate student and course tables and an enrolment table for the many-to-many relationship. Foreign keys connect the enrolment to valid parent rows.'
      ]
    ],
    sources: [relationalNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Primary keys',
    daysAgo: 13,
    exchanges: [
      [
        'Why use a primary key instead of a display name?',
        'A primary key supplies a stable row identity. Display names may change or collide, so they are poor references for relationships.'
      ]
    ],
    sources: [indexingQueries],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Normalisation',
    daysAgo: 12,
    exchanges: [
      [
        'What problem does normalisation address?',
        'It reduces redundancy and update anomalies by separating facts according to their dependencies. The goal is consistent representation, not simply more tables.'
      ]
    ],
    sources: [transactionExample],
    pages: [review],
    materials: [overview]
  });
  createNote(project, {
    title: 'SQL joins',
    daysAgo: 11,
    exchanges: [
      [
        'How does an inner join differ from a left join?',
        'An inner join keeps matching pairs. A left join also retains unmatched left-side rows, with nulls for the missing right-side values.'
      ]
    ],
    sources: [relationalNotes],
    pages: [workbook],
    materials: [cards]
  });
  createNote(project, {
    title: 'Indexes',
    daysAgo: 10,
    exchanges: [
      [
        'Why can an index help a selective query?',
        'An index provides an ordered access path that can avoid scanning every row. It consumes storage and adds maintenance work to writes.'
      ]
    ],
    sources: [indexingQueries],
    pages: [review],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Query plans',
    daysAgo: 9,
    exchanges: [
      [
        'What should I look for in a query plan?',
        'Check access paths, filtering and join order against the data distribution. A scan may be appropriate for a small table or a query returning most rows.'
      ]
    ],
    sources: [transactionExample],
    pages: [workbook],
    materials: [overview]
  });
  createNote(project, {
    title: 'Transaction boundaries',
    daysAgo: 8,
    exchanges: [
      [
        'Why keep a transaction around related writes?',
        'The transaction commits the related changes together or rolls them back together. This prevents readers from observing a partially updated invariant.'
      ]
    ],
    sources: [relationalNotes],
    pages: [review],
    materials: [cards]
  });
  createNote(project, {
    title: 'Isolation',
    daysAgo: 7,
    exchanges: [
      [
        'Can an application cache replace database constraints?',
        'No. Concurrent paths and process failures can bypass a cache. Constraints enforce invariants at the point where durable writes occur.'
      ]
    ],
    sources: [indexingQueries],
    pages: [workbook],
    materials: [quiz]
  });
  createNote(project, {
    title: 'Migrations',
    daysAgo: 6,
    exchanges: [
      [
        'How should a schema migration be verified?',
        'Test both a fresh database and an upgrade from representative populated data. Check retained relationships, defaults and constraints after the migration.'
      ]
    ],
    sources: [transactionExample],
    pages: [review],
    materials: [overview]
  });
  createNote(project, {
    title: 'Recovery exercise',
    daysAgo: 5,
    exchanges: [
      [
        'Why does a write-ahead log matter during recovery?',
        'Committed pages may still be in the WAL. A safe backup or replacement must account for those pages and coordinate with database ownership.'
      ]
    ],
    sources: [relationalNotes],
    pages: [workbook],
    materials: [cards]
  });
}
