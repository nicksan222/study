import { Button } from '@study/ui/button';
import { Spinner } from '@study/ui/spinner';
import { ChevronRight } from 'lucide-react';

export type DeletionVersion<Id> = {
  id: Id;
  label: string;
  description: string;
  status?: string;
  disabled?: boolean;
};

/** Version choices retain their owner identities and show unavailable entries without destructive controls. */
export function VersionDeletionList<Id>({
  items,
  selected,
  pending,
  pendingLabel,
  onSelect
}: {
  items: readonly DeletionVersion<Id>[];
  selected?: Id;
  pending: boolean;
  pendingLabel: string;
  onSelect: (id: Id) => void;
}) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {items.map((item) => (
        <li key={String(item.id)}>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
            disabled={item.disabled || pending}
            aria-busy={pending && selected === item.id}
            onClick={() => onSelect(item.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="block text-xs font-normal text-muted-foreground">
                {item.description}
              </span>
            </span>
            {item.status ? (
              <span className="text-xs font-normal text-muted-foreground">{item.status}</span>
            ) : pending && selected === item.id ? (
              <Spinner size="xs" label={pendingLabel} />
            ) : (
              <ChevronRight aria-hidden="true" className="text-muted-foreground" />
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}
