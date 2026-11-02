import { useRender } from '@base-ui/react/use-render';

import { semanticPart } from './semantic-part';

function Entry({ render, ...props }: Omit<useRender.ComponentProps<'a'>, 'className'>) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: {
      ...props,
      className:
        'group flex flex-col gap-1 rounded-md px-3 py-5 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-2'
    }
  });
}

export const HomeHub = {
  Root: semanticPart(
    'div',
    'mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 md:px-8 md:py-14'
  ),
  Header: semanticPart('div', 'space-y-2'),
  Title: semanticPart('h2', 'text-2xl font-semibold tracking-tight'),
  Description: semanticPart('p', 'max-w-prose text-sm text-muted-foreground'),
  Navigation: semanticPart('nav', 'divide-y divide-border'),
  Label: semanticPart('span', 'font-semibold'),
  Help: semanticPart('span', 'text-muted-foreground'),
  Entry
};
