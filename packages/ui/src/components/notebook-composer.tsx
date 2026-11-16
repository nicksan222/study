import { SendIcon } from '@study/icons';
import type { ComponentProps, ReactNode } from 'react';

import { ComposerSurface } from './composer';
import { Notebook } from './note-workspace';
import { WorkspaceSurface } from './workspace';

/** Controlled capture presentation; its owner handles attachments, persistence and recovery. */
export function NotebookComposer({
  role,
  inputId,
  label,
  hint,
  placeholder,
  submitLabel,
  value,
  onChange,
  onSubmit,
  disabled,
  spellcheck,
  attachments,
  tools,
  recovery,
  onPaste,
  onKeyDown,
  onDragOver,
  onDrop
}: {
  role?: ComponentProps<'section'>['role'];
  inputId: string;
  label: string;
  hint: string;
  placeholder?: string;
  submitLabel: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  spellcheck?: boolean;
  attachments?: ReactNode;
  tools?: ReactNode;
  recovery?: ReactNode;
  onPaste?: ComponentProps<'textarea'>['onPaste'];
  onKeyDown?: ComponentProps<'textarea'>['onKeyDown'];
  onDragOver?: ComponentProps<'section'>['onDragOver'];
  onDrop?: ComponentProps<'section'>['onDrop'];
}) {
  return (
    <ComposerSurface.Root
      role={role}
      variant="notebook"
      aria-label={label}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Notebook.Label htmlFor={inputId}>{label}</Notebook.Label>
      {attachments}
      <ComposerSurface.Input
        id={inputId}
        rows={1}
        value={value}
        spellCheck={spellcheck}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        aria-describedby={`${inputId}-help`}
        placeholder={placeholder ?? hint}
        onChange={(event) => onChange(event.target.value)}
      />
      <ComposerSurface.Footer variant="notebook">
        <Notebook.CaptureTools>{tools}</Notebook.CaptureTools>
        <Notebook.Actions>
          <WorkspaceSurface.ComposerSubmit
            aria-label={submitLabel}
            title={submitLabel}
            disabled={disabled}
            onClick={onSubmit}
          >
            <SendIcon size={18} aria-hidden="true" />
          </WorkspaceSurface.ComposerSubmit>
        </Notebook.Actions>
      </ComposerSurface.Footer>
      <WorkspaceSurface.ComposerHint id={`${inputId}-help`}>{hint}</WorkspaceSurface.ComposerHint>
      {recovery}
    </ComposerSurface.Root>
  );
}
