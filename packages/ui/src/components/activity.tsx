import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  ScanText
} from 'lucide-react';
import type { ComponentPropsWithRef, ComponentProps, ReactNode } from 'react';

import { Button } from './button';
import { semanticPart } from './semantic-part';

function Toggle(props: Omit<ComponentProps<typeof Button>, 'className' | 'variant'>) {
  return <Button {...props} variant="ghost" className="activity-row" />;
}

function State({
  state,
  ...props
}: Omit<ComponentPropsWithRef<'span'>, 'className'> & { state: string }) {
  return <span {...props} data-state={state} className="activity-state" />;
}

type Stage = { title: string; description: string };

function Empty({
  stages,
  children
}: {
  stages: readonly [Stage, Stage, Stage];
  children: ReactNode;
}) {
  return (
    <div className="activity-empty">
      <ol className="activity-flow">
        <StagePreview stage={stages[0]}>
          <div className="activity-flow-preview activity-flow-files" aria-hidden="true">
            <span className="activity-file-back">
              <AudioLines />
            </span>
            <span className="activity-file-front">
              <FileText />
              <i />
              <i />
              <i />
            </span>
          </div>
        </StagePreview>
        <StagePreview stage={stages[1]}>
          <div className="activity-flow-preview activity-flow-processing" aria-hidden="true">
            <span className="activity-scan">
              <ScanText />
            </span>
            <span className="activity-scan-lines">
              <i />
              <i />
              <i />
            </span>
          </div>
        </StagePreview>
        <StagePreview stage={stages[2]} last>
          <div className="activity-flow-preview activity-flow-result" aria-hidden="true">
            <span className="activity-result">
              <BookOpen />
              <i />
              <i />
            </span>
            <span className="activity-result-check">
              <Check />
            </span>
          </div>
        </StagePreview>
      </ol>
      <div className="activity-empty-footer">{children}</div>
    </div>
  );
}

function StagePreview({
  stage,
  last = false,
  children
}: {
  stage: Stage;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="activity-flow-step">
      {children}
      <span>{stage.title}</span>
      <p>{stage.description}</p>
      {!last && <ArrowRight className="activity-flow-arrow" aria-hidden="true" />}
    </li>
  );
}

function Chevron() {
  return <ChevronDown className="activity-chevron" aria-hidden="true" />;
}

export const ActivityPanel = {
  Root: semanticPart('div', 'activity-page'),
  Body: semanticPart('div', 'activity-body'),
  List: semanticPart('ul', 'activity-list'),
  Item: semanticPart('li', 'activity-item'),
  Icon: semanticPart('span', 'activity-task-icon'),
  Copy: semanticPart('span', 'activity-row-copy'),
  UpdateNote: semanticPart('p', 'activity-update-note'),
  Detail: semanticPart('div', 'activity-detail'),
  Metadata: semanticPart('dl', 'activity-metadata'),
  Toggle,
  State,
  Chevron,
  Empty
};
