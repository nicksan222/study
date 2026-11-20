import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';
import type { Tokens } from 'marked';
import { useMemo } from 'react';

import './source-markdown.css';

class MarkdownRenderer extends Renderer {
  override html() {
    return '';
  }

  override image(token: Tokens.Image) {
    // Keep the description without requesting the image or including a remote URL.
    return this.text({ type: 'text', raw: token.raw, text: token.text });
  }

  override link(token: Tokens.Link) {
    return super.link(token).replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  }

  override code(token: Tokens.Code) {
    return super.code(token).replace(/^<pre>/, '<pre tabindex="0">');
  }

  override table(token: Tokens.Table) {
    return `<div class="source-markdown-table" tabindex="0">${super.table(token)}</div>`;
  }
}

const markdown = new Marked();

export function SourceMarkdown({ bytes, fontSize }: { bytes: Uint8Array; fontSize: number }) {
  const html = useMemo(() => {
    const text = new TextDecoder().decode(bytes);
    const parsed = markdown.parse(text, {
      async: false,
      gfm: true,
      renderer: new MarkdownRenderer()
    });

    return DOMPurify.sanitize(parsed, {
      ALLOWED_TAGS: [
        'a',
        'blockquote',
        'br',
        'code',
        'del',
        'div',
        'em',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'hr',
        'input',
        'li',
        'ol',
        'p',
        'pre',
        'strong',
        'table',
        'tbody',
        'td',
        'th',
        'thead',
        'tr',
        'ul'
      ],
      ALLOWED_ATTR: [
        'align',
        'checked',
        'class',
        'disabled',
        'href',
        'rel',
        'start',
        'tabindex',
        'target',
        'title',
        'type'
      ],
      ADD_URI_SAFE_ATTR: ['align', 'rel', 'start', 'tabindex', 'target', 'type'],
      ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i
    });
  }, [bytes]);

  return (
    <article
      className="source-markdown"
      style={{ fontSize }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
