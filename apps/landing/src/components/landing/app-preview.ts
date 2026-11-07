import { Button } from '@study/ui/button';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Render the app's real presentation components at build time, without a client React bundle. */
export function downloadButton(label: string) {
  return renderToStaticMarkup(
    createElement(
      Button,
      {
        className: 'button button-brand button-large',
        size: 'xl',
        render: createElement('a', { href: '#download', 'data-download': '' })
      },
      createElement('span', { 'data-download-label': '' }, label)
    )
  );
}
