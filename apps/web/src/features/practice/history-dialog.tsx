import type { MaterialId, QuizAttemptId } from '@study/contracts/ids';
import type { quizAttemptSchema } from '@study/contracts/learning/schemas';
import { Button } from '@study/ui/button';
import { Dialog, DialogTrigger } from '@study/ui/dialog';
import { Practice } from '@study/ui/practice';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { WorkspaceCard } from '@study/ui/workspace';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { ArrowUpRight, History } from 'lucide-react';
import { useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { AttemptState } from './attempt-state';
import { attemptOptions, attemptsOptions } from './practice.queries';
import { PracticeQueryState } from './query-state';
import { QuizResults } from './quiz-results';

export function AttemptsAction({ id }: { id: MaterialId }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<WorkspaceCard.Item />}>
        <History aria-hidden="true" />
        <span>{t('PracticeAttempts')}</span>
        <ArrowUpRight aria-hidden="true" />
      </DialogTrigger>
      <Surface.Popup keepMounted closeLabel={t('Close')} bottomStickOnMobile={false}>
        <Surface.Title>{t('PracticeAttempts')}</Surface.Title>
        <AttemptsPanel id={id} open={open} close={() => setOpen(false)} />
      </Surface.Popup>
    </Dialog>
  );
}

function AttemptsPanel({ id, open, close }: { id: MaterialId; open: boolean; close: () => void }) {
  const { t, date } = useI18n();
  const history = useInfiniteQuery({ ...attemptsOptions(id), enabled: open });
  const [selected, select] = useState<QuizAttemptId>();
  const [search, setSearch] = useState('');
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const visible = items.filter(({ attempt }) =>
    (
      date(attempt.started_at) +
      ' ' +
      t(attempt.status === 'completed' ? 'PracticeViewResults' : 'PracticeResume')
    )
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase())
  );

  return (
    <Surface.Root>
      <Surface.Navigation aria-label={t('PracticeAttempts')}>
        <Surface.SearchField
          label={t('PracticeSearchAttempts')}
          value={search}
          onValueChange={setSearch}
        />
        {visible.map(({ attempt }) => (
          <Surface.Item
            key={String(attempt.id)}
            aria-current={selected === attempt.id ? 'true' : undefined}
            onClick={() => select(attempt.id)}
            icon={<History aria-hidden="true" />}
            label={date(attempt.started_at)}
            description={t(
              attempt.status === 'completed' ? 'PracticeViewResults' : 'PracticeResume'
            )}
          />
        ))}
        {search && visible.length === 0 && (
          <Surface.Message role="status">{t('SearchNoResults')}</Surface.Message>
        )}
        {history.hasNextPage && (
          <Button
            variant="ghost"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('LibraryMore')}
          </Button>
        )}
      </Surface.Navigation>
      <Surface.Main>
        <Surface.Header>
          <h2>{t('PracticeAttempts')}</h2>
        </Surface.Header>
        <Surface.Scroll>
          <Surface.Body>
            <PracticeQueryState state={history}>
              {selected ? (
                <AttemptPreview
                  key={String(selected)}
                  id={selected}
                  material={id}
                  open={open}
                  close={close}
                />
              ) : (
                <Surface.Empty>
                  <History aria-hidden="true" />
                  <strong>
                    {t(items.length ? 'PracticeChooseAttempt' : 'PracticeNoAttempts')}
                  </strong>
                </Surface.Empty>
              )}
            </PracticeQueryState>
          </Surface.Body>
        </Surface.Scroll>
      </Surface.Main>
    </Surface.Root>
  );
}

function AttemptPreview({
  id,
  material,
  open,
  close
}: {
  id: QuizAttemptId;
  material: MaterialId;
  open: boolean;
  close: () => void;
}) {
  const state = useQuery({ ...attemptOptions(id), enabled: open });

  return (
    <AttemptState state={state} material={material}>
      {(attempt) => <AttemptPreviewContent attempt={attempt} close={close} />}
    </AttemptState>
  );
}

function AttemptPreviewContent({
  attempt,
  close
}: {
  attempt: typeof quizAttemptSchema.Type;
  close: () => void;
}) {
  const { t } = useI18n();
  const search = useSearch({ from: '__root__' });

  if (attempt.status === 'completed')
    return <QuizResults attempt={attempt} presentation="preview" />;

  return (
    <>
      <p>{t('PracticeResumeHelp')}</p>
      <Button
        render={
          <Link
            to="/practice/$materialId"
            params={{ materialId: String(attempt.materialId) }}
            search={{ project: search.project, attempt: String(attempt.id) }}
          />
        }
        onClick={close}
      >
        {t('PracticeResume')}
      </Button>
      <Practice.Outline>
        <Practice.OutlineItems
          items={attempt.questions.map((question) => ({
            key: String(question.id),
            prompt: question.prompt,
            detail: t(question.answer ? 'PracticeAnswerRecorded' : 'PracticeUnanswered')
          }))}
        />
      </Practice.Outline>
    </>
  );
}
