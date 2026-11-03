import { projectInitials } from '@study/contracts/projects/schemas';
import { Identity } from '@study/ui/identity';

export function SubjectIdentity({
  name,
  icon,
  size
}: {
  name: string;
  icon?: string | null;
  size?: 'large';
}) {
  return <Identity text={icon ?? projectInitials(name)} data-size={size} />;
}
