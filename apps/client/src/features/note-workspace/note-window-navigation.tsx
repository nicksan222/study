import { CursorWindowActions } from '#client/lib/cursor-window.tsx';

/** Shared notebook navigation presents bounded live windows without owning query state. */
export function NoteWindowNavigation({
  state
}: {
  state: {
    pagination: { hasPrevious: boolean; previous: () => void };
    hasNextPage: boolean;
    isFetching: boolean;
    fetchNextPage: () => void;
  };
}) {
  return (
    <CursorWindowActions
      hasPrevious={state.pagination.hasPrevious}
      previous={state.pagination.previous}
      hasMore={state.hasNextPage}
      more={state.fetchNextPage}
      pending={state.isFetching}
    />
  );
}
