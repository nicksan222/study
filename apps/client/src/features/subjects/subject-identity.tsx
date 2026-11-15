import { automaticProjectIcon, projectInitials } from '@study/contracts';
import type { ProjectIcon } from '@study/contracts';
import { Identity } from '@study/ui';

import { subjectSymbols } from './subject-icon-options';

/** Renders the same canonical symbol, emoji, or initials badge on every subject surface. */
export function SubjectIdentity({
  name,
  icon = automaticProjectIcon,
  size
}: {
  name: string;
  icon?: ProjectIcon;
  size?: 'large';
}) {
  const Symbol = icon.kind === 'symbol' ? subjectSymbols[icon.value].Icon : undefined;
  const text = icon.kind === 'automatic' ? projectInitials(name) : icon.value;

  return (
    <Identity data-size={size} data-color={icon.color} data-kind={icon.kind}>
      {Symbol ? <Symbol aria-hidden="true" /> : text}
    </Identity>
  );
}
