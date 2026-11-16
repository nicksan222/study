import { test } from '@study/testing';

import { integrationProvider, integrationProviders } from '../src/index.ts';

const file = (path: string, text: string) => ({
  path,
  content: Buffer.from(text).toString('base64')
});

test.stable(
  'imports nested vault notes, preserving metadata, links, embeds and original bytes',
  () => {
    const plan = integrationProvider('obsidian').capabilities.import!.plan({
      files: [
        file(
          'Biology/Cells.md',
          '---\ntitle: "Cell biology"\ntags: [science]\n---\n# Cells\n\nSee [[DNA|genes]] and ![[images/cell.png]].'
        ),
        file('Biology/DNA.md', '# DNA\n\nGenetic material.'),
        file('images/cell.png', 'image bytes'),
        file('.obsidian/app.json', '{}'),
        file('.trash/Deleted.md', 'deleted')
      ]
    });

    test.expect(plan.notes.map((item) => item.key)).toEqual(['Biology/Cells.md', 'Biology/DNA.md']);
    test.expect(plan.notes[0]).toMatchObject({
      title: 'Cell biology',
      text: '# Cells\n\nSee [[DNA|genes]] and ![[images/cell.png]].',
      metadata: 'title: "Cell biology"\ntags: [science]',
      attachments: ['images/cell.png'],
      links: [
        {
          raw: '[[DNA|genes]]',
          target: 'Biology/DNA.md',
          label: 'genes',
          fragment: '',
          embedded: false
        }
      ]
    });
    test
      .expect(plan.files.find((item) => item.path === 'Biology/Cells.md')?.content)
      .toBe(
        file(
          '',
          '---\ntitle: "Cell biology"\ntags: [science]\n---\n# Cells\n\nSee [[DNA|genes]] and ![[images/cell.png]].'
        ).content
      );
    test.expect(plan.warnings).toEqual([]);
  }
);

test.stable(
  'reports ambiguous and missing references without discarding note text or inventing targets',
  () => {
    const plan = integrationProvider('obsidian').capabilities.import!.plan({
      files: [
        file('Home.md', '[[Same]] [[Missing]] ![[photo.png]]\n```md\n[[not a link]]\n```'),
        file('a/Same.md', 'A'),
        file('b/Same.md', 'B')
      ]
    });

    test.expect(plan.notes.find((item) => item.key === 'Home.md')?.links).toEqual([]);
    test
      .expect(plan.warnings.map((warning) => warning.code))
      .toEqual(['ambiguous_link', 'missing_link', 'missing_attachment']);
    test.expect(plan.notes.find((item) => item.key === 'Home.md')?.text).toContain('[[Missing]]');
  }
);

test.stable.each(['../escape.md', '/absolute.md', 'a/../../escape.md', 'C:\\escape.md', 'a\\b.md'])(
  'rejects unsafe vault entry %s',
  (path) => {
    test
      .expect(() =>
        integrationProvider('obsidian').capabilities.import!.plan({ files: [file(path, 'text')] })
      )
      .toThrow();
  }
);

test.stable('rejects duplicate paths and invalid text encoding; reports empty notes', () => {
  const provider = integrationProvider('obsidian').capabilities.import!;

  test.expect(() => provider.plan({ files: [file('A.md', 'one'), file('A.md', 'two')] })).toThrow();
  test.expect(() => provider.plan({ files: [{ path: 'A.md', content: '/w==' }] })).toThrow();
  test
    .expect(provider.plan({ files: [file('Empty.md', '   ')] }).warnings)
    .toEqual([{ code: 'empty_note', path: 'Empty.md', target: null }]);
});

test.stable('discovers provider capabilities without advertising unsupported export', () => {
  test.expect(integrationProviders()).toEqual([{ id: 'obsidian', capabilities: ['import'] }]);
  test.expect(() => integrationProvider('unknown')).toThrow();
});
