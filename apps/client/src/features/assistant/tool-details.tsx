import type { agentToolProgressSchema } from '@study/contracts/ai/progress';
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockContent,
  CodeBlockFooter
} from '@study/ui/code-block';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentToolOutcome } from '../agent-progress';

type Tool = typeof agentToolProgressSchema.Type;

/** Tool payloads are inert, bounded text, including after a failed call. */
export function AssistantToolDetails({ tool }: { tool: Tool }) {
  const { t } = useI18n();

  return (
    <>
      {tool.input && <Detail label={t('AssistantToolInput')} detail={tool.input} />}
      {tool.output && <Detail label={t('AssistantToolOutput')} detail={tool.output} />}
      <AgentToolOutcome tool={tool} />
    </>
  );
}

function Detail({ label, detail }: { label: string; detail: NonNullable<Tool['input']> }) {
  const { t } = useI18n();

  return (
    <CodeBlock size="sm" variant="muted">
      <CodeBlockHeader>
        <CodeBlockTitle>{label}</CodeBlockTitle>
      </CodeBlockHeader>
      <CodeBlockContent wrap role="region" aria-label={label}>
        {detail.text}
      </CodeBlockContent>
      {detail.truncated && <CodeBlockFooter>{t('AssistantToolTruncated')}</CodeBlockFooter>}
    </CodeBlock>
  );
}
