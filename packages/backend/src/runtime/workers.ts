import type { AuthManager } from '@study/ai';
import {
  createChatGptModel,
  createStudyAgents,
  generateMaterial,
  streamReply,
  ChatGptRequestError
} from '@study/ai';
import { sql } from 'drizzle-orm';

import { listSessions as opListSessions } from '#backend/procedures/conversations/all-sessions';
import {
  listMessages as opListMessages,
  message as opMessage,
  versionCitations as opVersionCitations
} from '#backend/procedures/conversations/messages';
import {
  replaceWithGeneratedTitle as opReplaceWithGeneratedTitle,
  setGeneratedTitle as opSetGeneratedTitle
} from '#backend/procedures/conversations/regenerate-title';
import { session as opSession } from '#backend/procedures/conversations/session';
import { thread as opThread } from '#backend/procedures/conversations/thread';
import {
  beginVersion as opBeginVersion,
  finishVersion as opFinishVersion
} from '#backend/procedures/conversations/versions';
import { job as opJob } from '#backend/procedures/jobs/job';
import {
  recoverJobs as opRecoverJobs,
  claimJob as opClaimJob,
  finishJob as opFinishJob,
  failJob as opFailJob,
  enqueueJob as opEnqueueJob
} from '#backend/procedures/jobs/worker';
import { artifact as opArtifact } from '#backend/procedures/material/artifact';
import { finishMaterial as opFinishMaterial } from '#backend/procedures/material/finish-material';
import { finishGrade as opFinishGrade } from '#backend/procedures/practice/finish-grade';
import { finishQuestion as opFinishQuestion } from '#backend/procedures/practice/finish-question';
import {
  question as opQuestion,
  listQuestions as opListQuestions
} from '#backend/procedures/practice/practice';
import { listPractices as opListPractices } from '#backend/procedures/practice/practices';
import { language } from '#backend/procedures/settings/get-app-settings';
import { model as readModel } from '#backend/procedures/settings/get-llm-settings';
import { loadPreferences as opLoadPreferences } from '#backend/procedures/settings/preferences';
import { fetchPage } from '#backend/procedures/sources/fetch';
import { readSource, readerFor } from '#backend/procedures/sources/readers/read';
import {
  source as opSource,
  storeFetched as opStoreFetched,
  readSourceBounded as opReadSourceBounded
} from '#backend/procedures/sources/source';
import {
  saveRead as opSaveRead,
  document as opDocument
} from '#backend/procedures/sources/source-document';
import { listSources as opListSources } from '#backend/procedures/sources/sources';
import { replacePassages as opReplacePassages } from '#backend/procedures/system/index';
import { search as opSearch } from '#backend/procedures/system/search';
import { classifyError, StudyError } from '#backend/shared/errors/index';
import type { ProjectId } from '#backend/shared/ids';
import type { VersionId } from '#backend/shared/ids';
import type { Job } from '#backend/shared/jobs/types';

import type { BackendContext } from './context.ts';
import { Evidence } from './grounding.ts';

/** One durable job consumer. Database leases guard every asynchronous result. */
export class Workers {
  private readonly store: BackendContext;
  private readonly auth: AuthManager;
  private readonly request?: typeof fetch;
  private timer?: ReturnType<typeof setInterval>;
  private unsubscribe?: () => void;
  private active?: {
    job: Job;
    controller: AbortController;
  };
  private running?: Promise<void>;
  private stopped = true;

  constructor(store: BackendContext, auth: AuthManager, request?: typeof fetch) {
    this.store = store;
    this.auth = auth;
    this.request = request;
  }

  get started() {
    return !this.stopped;
  }

  start() {
    if (!this.stopped) return;

    this.stopped = false;
    opRecoverJobs(this.store);
    this.unsubscribe = this.store.subscribe(() => {
      if (this.active) {
        const current = opJob(this.store, this.active.job.id);

        if (current?.status !== 'running' || current.attempts !== this.active.job.attempts)
          this.active.controller.abort();
      }

      this.wake();
    });
    this.timer = setInterval(() => this.wake(), 500);
    this.timer.unref();
    this.wake();
  }

  wake() {
    if (this.stopped || this.running) return;

    this.running = Promise.resolve()
      .then(() => this.drain())
      .finally(() => {
        this.running = undefined;
      });
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.active?.controller.abort();
    await this.running;
    opRecoverJobs(this.store);
  }

  private async drain() {
    while (!this.stopped) {
      const job = opClaimJob(this.store, [
        'fetch',
        'extract',
        'index',
        'title',
        'reply',
        'rewrite',
        'artifact',
        'question',
        'grade'
      ]);

      if (!job) return;

      const controller = new AbortController();

      this.active = {
        job,
        controller
      };

      try {
        await this.run(job, controller.signal);

        if (!controller.signal.aborted) opFinishJob(this.store, job.id, job.attempts);
      } catch (error) {
        const failure = controller.signal.aborted
          ? {
              kind: 'cancelled' as const,
              message: 'Job cancelled',
              retryAfterMs: null
            }
          : error instanceof ChatGptRequestError
            ? {
                kind: error.kind,
                message: error.message,
                retryAfterMs: null
              }
            : classifyError(error);

        if (!this.stopped) opFailJob(this.store, job.id, job.attempts, failure);
      } finally {
        this.active = undefined;
      }
    }
  }

  private model(tier: 'tiny' | 'medium' | 'smart') {
    if (!opLoadPreferences(this.store, 'private.chatgpt').account)
      throw new StudyError('auth', 'Sign-in required');

    return createChatGptModel({
      auth: this.auth,
      modelId: readModel(this.store, tier),
      fetch: this.request
    });
  }

  private context(project: ProjectId, evidence: Evidence) {
    const sources = opListSources(this.store)
      .filter((s) => s.projectId === project)
      .flatMap((s) => {
        const text = evidence.source(s.id);

        return text ? [text] : [];
      });
    const notes = opListSessions(this.store, project)
      .flatMap((s) => opListMessages(this.store, s.id))
      .filter((m) => m.role === 'user')
      .map((m) => m.versions.find((v) => v.id === m.activeVersionId)?.text ?? '')
      .filter(Boolean);

    return {
      sources,
      notes,
      prompt: JSON.stringify({
        sources,
        notes
      })
    };
  }

  private agents(
    project: ProjectId,
    tier: 'tiny' | 'medium' | 'smart',
    evidence: Evidence = new Evidence(this.store, project)
  ) {
    return createStudyAgents({
      model: this.model(tier),
      language: language(this.store),
      capabilities: {
        searchSources: async (query, signal) => {
          signal?.throwIfAborted();
          const ids = new Set(
            opSearch(this.store, query, {
              projectId: project,
              kinds: ['source', 'passage'],
              limit: 20
            }).flatMap((h) =>
              h.target.type === 'source'
                ? [h.target.id]
                : h.target.type === 'passage'
                  ? [h.target.sourceId]
                  : []
            )
          );

          return [...ids].flatMap((id) => {
            const text = evidence.source(id);

            return text ? [text] : [];
          });
        }
      }
    });
  }

  private args(job: Job) {
    return job.args && typeof job.args === 'object' && !Array.isArray(job.args) ? job.args : {};
  }

  private current(job: Job, signal: AbortSignal) {
    signal.throwIfAborted();
    const current = opJob(this.store, job.id);

    if (current?.status !== 'running' || current.attempts !== job.attempts)
      throw new StudyError('cancelled', 'Job superseded');
  }

  private async run(job: Job, signal: AbortSignal) {
    const store = this.store;

    if (job.kind === 'fetch' && job.target.type === 'source') {
      const source = opSource(store, job.target.id);

      if (!source?.uri) throw new StudyError('not_found', 'Link missing');

      const page = await fetchPage(source.uri, {
        signal,
        fetch: this.request
      });

      this.current(job, signal);
      store.transaction(() => {
        const fetched = opStoreFetched(store, source.id, {
          name: page.name,
          bytes: page.bytes,
          kind: 'web',
          mime: page.mime,
          uri: page.url
        });

        if (!fetched) throw new StudyError('not_found', 'Fetched source missing');

        const extraction = opEnqueueJob(store, {
          kind: 'extract',
          target: {
            type: 'source',
            id: fetched.id
          },
          after: [job.id]
        });

        store.db.orm.run(sql`INSERT OR IGNORE INTO job_deps (job_id, depends_on)
          SELECT consumer.id, ${extraction}
          FROM job_deps dependency JOIN jobs consumer ON consumer.id = dependency.job_id
          WHERE dependency.depends_on = ${job.id}
            AND consumer.id != ${extraction}
            AND consumer.status IN ('queued', 'blocked', 'waiting')`);
      });

      return;
    }

    if (job.kind === 'extract' && job.target.type === 'source') {
      const source = opSource(store, job.target.id);

      if (!source) throw new StudyError('not_found', 'Source missing');

      const reader = readerFor(source);
      const bytes = opReadSourceBounded(store, source.id, 16 * 1024 * 1024);

      if (!bytes) throw new StudyError('invalid_input', 'Source exceeds reader limit');

      const document = await readSource(
        {
          ...source,
          bytes,
          url: source.uri ?? undefined
        },
        {
          signal,
          model: reader.kind === 'vision' ? this.model('medium') : undefined
        }
      );

      this.current(job, signal);
      store.transaction(() => {
        const id = opSaveRead(store, job.id, job.attempts, source.id, document);

        if (id)
          opEnqueueJob(store, {
            kind: 'index',
            target: {
              type: 'document',
              id
            }
          });
      });

      return;
    }

    if (job.kind === 'index' && job.target.type === 'document') {
      const document = opDocument(store, job.target.id);

      if (!document) throw new StudyError('not_found', 'Document missing');

      opReplacePassages(
        store,
        job.target.id,
        document.blocks.flatMap((b, i) =>
          b.text.trim()
            ? [
                {
                  firstBlock: i,
                  lastBlock: i,
                  anchor: b.anchor,
                  text: b.text
                }
              ]
            : []
        )
      );

      return;
    }

    if (job.kind === 'title' && job.target.type === 'session') {
      const session = opSession(store, job.target.id);

      if (!session) throw new StudyError('not_found', 'Session missing');

      const text = opListMessages(store, session.id)
        .map((m) => m.versions.find((v) => v.id === m.activeVersionId)?.text ?? '')
        .join('\n');

      if (!text.trim()) throw new StudyError('not_enough', 'No session content');

      const result = await this.agents(session.projectId, 'tiny').title.generate({
        prompt: text,
        abortSignal: signal
      });

      this.current(job, signal);

      if (this.args(job).force === true)
        opReplaceWithGeneratedTitle(store, session.id, result.text.trim());
      else opSetGeneratedTitle(store, session.id, result.text.trim());

      return;
    }

    if ((job.kind === 'reply' || job.kind === 'rewrite') && job.target.type === 'message') {
      const message = opMessage(store, job.target.id);
      const session = message && opSession(store, message.sessionId);

      if (!message || !session) throw new StudyError('not_found', 'Message missing');

      const raw = this.args(job).versionId;
      const versionId =
        typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw) ? (BigInt(raw) as VersionId) : null;

      if (!versionId || !opBeginVersion(store, versionId, job.id, job.attempts))
        throw new StudyError('cancelled', 'Version superseded');

      const version = opMessage(store, message.id)!.versions.find((v) => v.id === versionId)!;
      const previous =
        job.kind === 'rewrite' && version.basedOn ? opVersionCitations(store, version.basedOn) : [];
      const evidence = new Evidence(store, session.projectId, previous);
      const agents = this.agents(session.projectId, 'medium', evidence);
      let text: string;

      if (job.kind === 'reply') {
        const timeline = message.threadRoot
          ? (opThread(store, message.threadRoot)?.messages ?? [])
          : opListMessages(store, session.id);
        const messages = timeline
          .filter(
            (m) =>
              m.id !== message.id &&
              m.threadRoot === message.threadRoot &&
              (!message.replyTo || m.id <= message.replyTo)
          )
          .map((m) => ({
            role: m.role,
            content: JSON.stringify({
              text: m.versions.find((v) => v.id === m.activeVersionId)?.text ?? '',
              attachments: m.parts.flatMap((p) => {
                const source = p.sourceId ? evidence.source(p.sourceId) : null;

                return source ? [source] : [];
              })
            })
          }));

        if (message.threadRoot) {
          const owner = opListMessages(store, session.id)
            .flatMap((m) => m.parts)
            .find((p) => p.id === message.threadRoot);
          const source = owner?.sourceId ? evidence.source(owner.sourceId) : null;

          if (source)
            messages.unshift({
              role: 'user',
              content: JSON.stringify({
                threadSource: source
              })
            });
        }

        text = await streamReply(agents, messages, {}, signal);
      } else {
        const version = opMessage(store, message.id)!.versions.find((v) => v.id === versionId)!;
        const before = message.versions.find((v) => v.id === version.basedOn)?.text ?? '';
        const result = await agents.rewrite.generate({
          prompt: JSON.stringify({
            text: before,
            action: version.origin,
            instruction: version.instruction
          }),
          abortSignal: signal
        });

        text = result.text;
      }

      this.current(job, signal);
      const grounded = evidence.text(text);

      opFinishVersion(store, versionId, job.id, job.attempts, grounded.value, grounded.citations);

      return;
    }

    if (job.kind === 'artifact' && job.target.type === 'artifact') {
      const artifact = opArtifact(store, job.target.id);

      if (!artifact) throw new StudyError('not_found', 'Material missing');

      const evidence = new Evidence(store, artifact.projectId);
      const context = this.context(artifact.projectId, evidence);

      if (!context.sources.length && !context.notes.length)
        throw new StudyError('not_enough', 'No study content');

      const result = await generateMaterial(
        this.agents(artifact.projectId, 'smart', evidence),
        context.prompt,
        {
          kind: artifact.kind,
          signal
        }
      );

      this.current(job, signal);
      const grounded =
        result.type === 'diagram'
          ? {
              type: 'diagram' as const,
              mermaid: evidence.text(result.mermaid).value
            }
          : {
              type: 'flashcards' as const,
              cards: result.cards.map((card) => ({
                front: evidence.text(card.front).value,
                back: evidence.text(card.back).value,
                cites: evidence.references(card.cites)
              }))
            };

      opFinishMaterial(store, artifact.id, job.id, job.attempts, grounded, evidence.citations);

      return;
    }

    if ((job.kind === 'question' || job.kind === 'grade') && job.target.type === 'question') {
      const question = opQuestion(store, job.target.id);
      const practice = question && opListPractices(store).find((p) => p.id === question.practiceId);

      if (!question || !practice) throw new StudyError('not_found', 'Question missing');

      const evidence = new Evidence(store, practice.projectId, question.citations);
      const agents = this.agents(practice.projectId, 'medium', evidence);

      if (job.kind === 'question') {
        const context = this.context(practice.projectId, evidence);

        if (!context.sources.length && !context.notes.length)
          throw new StudyError('not_enough', 'No study content');

        const prior = opListQuestions(store, practice.id).flatMap((q) => (q.gist ? [q.gist] : []));
        const result = await agents.question(
          question.kind,
          JSON.stringify({
            context,
            prior
          }),
          signal
        );

        this.current(job, signal);
        const body =
          result.type === 'choice'
            ? {
                ...result,
                question: evidence.text(result.question).value,
                choices: result.choices.map((c) => evidence.text(c).value),
                explanation: evidence.text(result.explanation).value,
                cites: evidence.references(result.cites)
              }
            : {
                ...result,
                question: evidence.text(result.question).value,
                reference: evidence.text(result.reference).value,
                cites: evidence.references(result.cites)
              };

        opFinishQuestion(
          store,
          question.id,
          job.id,
          job.attempts,
          body,
          result.gist,
          evidence.citations
        );
      } else {
        const result = await agents.grade.generate({
          prompt: JSON.stringify({
            question: question.body,
            answer: question.answer
          }),
          abortSignal: signal
        });

        this.current(job, signal);
        opFinishGrade(
          store,
          question.id,
          job.id,
          job.attempts,
          result.output.verdict,
          evidence.text(result.output.feedback).value
        );
      }

      return;
    }

    throw new StudyError('unsupported', 'No worker supports this job');
  }
}
