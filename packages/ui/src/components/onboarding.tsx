import { BackIcon, NextIcon, PageIcon, AttachmentIcon } from '@study/icons';
import type { ReactNode } from 'react';

import { Button } from './button.tsx';
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from './dialog.tsx';
import { RichNoteContent } from './rich-note.tsx';

/** A focused, keyboard-accessible welcome with a stable reading and action area. */
export function Onboarding({
  open,
  appName,
  title,
  description,
  visual,
  steps,
  step,
  backLabel,
  nextLabel,
  skipLabel,
  closeLabel,
  pending,
  error,
  onBack,
  onNext,
  onClose
}: {
  open: boolean;
  appName: string;
  title: string;
  description: string;
  visual: ReactNode;
  steps: readonly string[];
  step: number;
  backLabel: string;
  nextLabel: string;
  skipLabel: string;
  closeLabel: string;
  pending: boolean;
  error?: string;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogPopup
        className="ui-onboarding"
        closeLabel={closeLabel}
        showCloseButton={false}
        bottomStickOnMobile={false}
      >
        <div className="ui-onboarding-top">
          <span>{appName}</span>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {skipLabel}
          </Button>
        </div>
        <div className="ui-onboarding-content" key={step}>
          <div className="ui-onboarding-copy">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          <div className="ui-onboarding-visual">{visual}</div>
        </div>
        {error && (
          <p className="ui-onboarding-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-onboarding-footer">
          <ol className="ui-onboarding-progress">
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={index === step ? 'step' : undefined}
                data-complete={index < step}
              >
                <span className="sr-only">{label}</span>
              </li>
            ))}
          </ol>
          <div className="ui-onboarding-actions">
            {step > 0 && (
              <Button variant="ghost" onClick={onBack} disabled={pending}>
                <BackIcon />
                {backLabel}
              </Button>
            )}
            <Button onClick={onNext} disabled={pending}>
              {nextLabel}
              <NextIcon />
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** A minimal sample using the same note renderer as the real notebook. */
export function OnboardingNotebook({
  label,
  note,
  file
}: {
  label: string;
  note: string;
  file: string;
}) {
  return (
    <div className="ui-onboarding-notebook">
      <header>
        <PageIcon aria-hidden="true" />
        <span>{label}</span>
      </header>
      <div className="ui-onboarding-notebook-page">
        <RichNoteContent value={note} />
        <div className="ui-onboarding-file">
          <AttachmentIcon aria-hidden="true" />
          {file}
        </div>
      </div>
    </div>
  );
}

export function OnboardingSetup({ children }: { children: ReactNode }) {
  return <div className="ui-onboarding-setup">{children}</div>;
}
