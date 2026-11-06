import { Node } from '@tiptap/core';
import katex from 'katex';
import { memo } from 'react';

import 'katex/dist/katex.min.css';

/** Parse math before Markdown interprets backslashes, emphasis or subscripts. */
export const inlineNoteMath = Node.create({
  name: 'inlineNoteMath',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: '' } }),
  renderHTML: ({ node }) => ['span', { 'data-note-math': true }, node.attrs.latex],
  parseMarkdown: (token) => ({ type: 'inlineNoteMath', attrs: { latex: token.text } }),
  markdownTokenizer: {
    name: 'inlineNoteMath',
    level: 'inline',
    start: (source) => source.search(/\\\(|\$(?!\$)/),
    tokenize: (source) => {
      const match = /^(?:\\\(([^\n]*?)\\\)|\$(?![\s$])([^\n$]*?[^\\\s])\$(?!\d))/.exec(source);

      if (!match) return undefined;

      return { type: 'inlineNoteMath', raw: match[0], text: match[1] ?? match[2] };
    }
  }
});

export const blockNoteMath = Node.create({
  name: 'blockNoteMath',
  group: 'block',
  atom: true,
  addAttributes: () => ({ latex: { default: '' } }),
  renderHTML: ({ node }) => ['div', { 'data-note-math': true }, node.attrs.latex],
  parseMarkdown: (token) => ({ type: 'blockNoteMath', attrs: { latex: token.text } }),
  markdownTokenizer: {
    name: 'blockNoteMath',
    level: 'block',
    start: (source) => source.search(/^(?:\s*\\\[|\s*\$\$)/m),
    tokenize: (source) => {
      const match = /^\s*(?:\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$)(?:[ \t]*\n|$)/.exec(source);

      if (!match) return undefined;

      return { type: 'blockNoteMath', raw: match[0], text: (match[1] ?? match[2]).trim() };
    }
  }
});

export const NoteMath = memo(function NoteMath({
  latex,
  display = false
}: {
  latex: string;
  display?: boolean;
}) {
  const html = katex.renderToString(latex, {
    displayMode: display,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 200,
    maxSize: 20,
    errorColor: 'currentColor'
  });
  const Tag = display ? 'div' : 'span';

  return <Tag className="rich-note-math" dangerouslySetInnerHTML={{ __html: html }} />;
});
