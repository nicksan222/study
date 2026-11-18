import { Field, Notebook, Textarea } from '@study/ui';
import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { DictationButton } from './button.tsx';
import { useTextDictation } from './use-text-dictation';

/** Opt-in dictation for long prose fields; the caller still owns its draft. Labels wrap only the input, never its actions. */
export function DictationTextarea({
  value,
  onValueChange,
  targetKey,
  label,
  toolbarLabel,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'ref' | 'header'> & {
  targetKey?: string | number | bigint;
  label?: ReactNode;
  toolbarLabel?: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const dictation = useTextDictation({
    value,
    onChange: onValueChange,
    input,
    maxLength: props.maxLength
  });

  const action = (
    <DictationButton
      targetKey={targetKey}
      {...dictation}
      disabled={props.disabled || props.readOnly}
    />
  );
  const control = (
    <Textarea
      {...props}
      ref={input}
      header={toolbarLabel ? { label: toolbarLabel, action } : undefined}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );

  if (toolbarLabel) return control;

  return (
    <>
      {label ? <Field label={label}>{control}</Field> : control}
      <Notebook.Actions>{action}</Notebook.Actions>
    </>
  );
}
