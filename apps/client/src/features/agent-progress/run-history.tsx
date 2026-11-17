import type { agentProgressSchema } from '@study/contracts';
import { CompletedIcon, ErrorIcon, CancelledIcon, ThinkingIcon } from '@study/icons';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionTitle,
  AccordionContent,
  Badge,
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceIcon,
  TraceTitle,
  ToolActivity
} from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { runPurposeLabels } from './run-labels';
import { AgentToolCall } from './tool-call';
import { settledAgentTool } from './tool-state';

type Run = typeof agentProgressSchema.Type;

type Node = { run: Run; index: number; children: Node[] };

const labels = {
  running: 'workspace.state.running',
  completed: 'AgentActivityStepComplete',
  failed: 'AgentActivityStepFailed',
  cancelled: 'AgentActivityStepCancelled'
} as const;

const icons = {
  running: ThinkingIcon,
  completed: CompletedIcon,
  failed: ErrorIcon,
  cancelled: CancelledIcon
};

/** Missing parents are expected when persisted history reaches its retention limit. */
function runTree(runs: readonly Run[]): Node[] {
  const nodes = runs.map((run, index) => ({ run, index, children: [] as Node[] }));
  const byId = new Map(nodes.map((node) => [node.run.runId, node]));
  const roots: Node[] = [];

  for (const node of nodes) {
    const parent = node.run.trace?.parentRunId;
    const ancestor = parent ? byId.get(parent) : undefined;
    let cursor = ancestor;
    const visited = new Set([node.run.runId]);

    while (cursor && !visited.has(cursor.run.runId)) {
      visited.add(cursor.run.runId);
      const id = cursor.run.trace?.parentRunId;

      cursor = id ? byId.get(id) : undefined;
    }

    if (ancestor && !cursor) ancestor.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export function RunHistory({ runs }: { runs: readonly Run[] }) {
  return <RunNodes nodes={runTree(runs)} />;
}

function RunNodes({ nodes }: { nodes: readonly Node[] }) {
  const [expanded, setExpanded] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const value = nodes
    .filter(
      ({ run }) => expanded.get(run.runId) ?? (run.status === 'running' || run.status === 'failed')
    )
    .map((node) => node.run.runId);

  if (!nodes.length) return null;

  return (
    <Accordion
      multiple
      value={value}
      onValueChange={(next) =>
        setExpanded(
          new Map([
            ...expanded,
            ...nodes
              .filter(({ run }) => value.includes(run.runId) !== next.includes(run.runId))
              .map(({ run }) => [run.runId, next.includes(run.runId)] as const)
          ])
        )
      }
    >
      {nodes.map((node) => (
        <RunNode key={node.run.runId} node={node} />
      ))}
    </Accordion>
  );
}

function RunNode({ node }: { node: Node }) {
  const { t } = useI18n();
  const { run, children, index } = node;
  const trace = run.trace;
  const Icon = icons[run.status];
  const title = trace
    ? t(runPurposeLabels[trace.purpose])
    : t('AgentActivityStep', { number: index + 1 });
  const detached = children.filter(
    (child) => !run.tools.some((tool) => tool.toolCallId === child.run.trace?.parentToolCallId)
  );

  return (
    <AccordionItem value={run.runId}>
      <AccordionTrigger>
        <TraceIcon>
          <Icon />
        </TraceIcon>
        <AccordionTitle>{title}</AccordionTitle>{' '}
        <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
          {t(labels[run.status])}
        </Badge>
      </AccordionTrigger>
      <AccordionContent>
        <RunMetadata run={run} />
        <RunPayload run={run} />
        <Trace>
          {run.tools.map((tool) => (
            <AgentToolCall key={tool.toolCallId} tool={settledAgentTool(tool, run)}>
              <RunNodes
                nodes={children.filter(
                  (child) => child.run.trace?.parentToolCallId === tool.toolCallId
                )}
              />
            </AgentToolCall>
          ))}
          <RunNodes nodes={detached} />
        </Trace>
      </AccordionContent>
    </AccordionItem>
  );
}

function RunMetadata({ run }: { run: Run }) {
  const { t, number } = useI18n();
  const trace = run.trace;
  const duration =
    trace?.finishedAtMs === undefined
      ? undefined
      : number(Math.max(0, Number(trace.finishedAtMs - trace.startedAtMs) / 1000), {
          maximumFractionDigits: 2
        });

  return (
    <ToolActivity.Metadata>
      {trace && (
        <ToolActivity.Note>
          {t('AgentRunAttempt', { attempt: number(trace.attempt) })}
        </ToolActivity.Note>
      )}
      {duration !== undefined && (
        <ToolActivity.Note>{t('AssistantToolElapsed', { seconds: duration })}</ToolActivity.Note>
      )}
      {run.usage && run.usage.requests > 0 && (
        <ToolActivity.Note>
          {t('AgentRunUsage', {
            input: number(run.usage.input),
            output: number(run.usage.output),
            requests: number(run.usage.requests)
          })}
        </ToolActivity.Note>
      )}
    </ToolActivity.Metadata>
  );
}

function hasRunDetails(run: Run) {
  return Boolean(run.trace?.input || run.trace?.output || run.text || run.failureKind);
}

function RunDetail({
  label,
  detail
}: {
  label: string;
  detail: NonNullable<Run['trace']>['input'];
}) {
  const { t } = useI18n();

  if (!detail) return null;

  return (
    <ToolActivity.Detail
      label={label}
      text={detail.text}
      notice={detail.truncated ? t('AssistantToolTruncated') : undefined}
    />
  );
}

function RunPayload({ run }: { run: Run }) {
  const { t } = useI18n();
  const trace = run.trace;
  const output = trace?.output ?? (run.text ? { text: run.text, truncated: false } : undefined);

  if (!hasRunDetails(run)) return null;

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{t('AgentRunDetails')}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent layout="details">
        <RunDetail label={t('AssistantToolInput')} detail={trace?.input} />
        <RunDetail label={t('AssistantToolOutput')} detail={output} />
        {run.failureKind && (
          <ToolActivity.Note>
            {t('AssistantToolErrorKind')}: <ToolActivity.Name>{run.failureKind}</ToolActivity.Name>
          </ToolActivity.Note>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
