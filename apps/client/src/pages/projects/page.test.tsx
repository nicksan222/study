import { projectIdSchema, automaticProjectIcon } from '@study/contracts';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';

test.stable.for(['english', 'italian'] as const)(
  'opens the Projects page in %s',
  async (locale, { page, rpc }) => {
    rpc.given({
      'projects.project': {
        id: projectIdSchema.make(9007199254740993n),
        name: 'Biology',
        icon: automaticProjectIcon,
        examOn: null,
        createdAt: 1n,
        updatedAt: 1n
      }
    });
    const { router } = page.open('/projects?project=9007199254740993', { locale });

    test
      .expect(await test.screen.findByRole('heading', { name: catalogs[locale].Projects }))
      .toBeInTheDocument();
    test.expect(router.state.location.search.project).toBe('9007199254740993');
  }
);
