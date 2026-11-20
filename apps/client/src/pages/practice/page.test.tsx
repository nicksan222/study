import { projectIdSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.unit.stable.for(['english', 'italian'] as const)(
  'shows study-note work in %s',
  async (locale, { page, expect, screen, rpc }) => {
    const copy = catalogs[locale];

    rpc.given({
      'pages.merges': [
        {
          id: 'document/study-notes/request',
          eventId: 'event',
          contextRequestId: 'study-notes/request',
          noteId: null,
          title: 'Field observations',
          instruction: '',
          operations: ['summarize', 'structure'],
          resultVersionId: null,
          cancelled: false,
          errorKind: null,
          report: null,
          studyNotes: {
            key: '2d514865-431d-4d4e-935d-b034fb0cbb66',
            projectId: projectIdSchema.make(9007199254740993n),
            title: 'Field observations',
            instruction: '',
            language: locale,
            inputs: [{ kind: 'note', contextId: '80657b94-7df2-4310-b20d-8a2fba4f47c1' }]
          }
        }
      ]
    });
    const { router } = await page.open('/practice?project=9007199254740993', { locale });

    expect(
      await screen.findByRole('heading', { name: copy.PracticeStudyNotesTitle })
    ).toBeVisible();
    expect(await screen.findByText('Field observations')).toBeVisible();
    expect(screen.getByText(copy.PracticeStudyNotesGenerating)).toBeVisible();
    expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
