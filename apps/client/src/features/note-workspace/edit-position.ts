import type { RichNoteSelection } from '@study/ui';

export type EditPosition = {
  scroll: number;
  inputScroll: number;
  start: number;
  end: number;
  direction: 'forward' | 'backward' | 'none';
  rich?: RichNoteSelection;
};

export const initialEditPosition = (): EditPosition => ({
  scroll: 0,
  inputScroll: 0,
  start: 0,
  end: 0,
  direction: 'none'
});
