import { api, sqlTokens, templateText } from './persistence-syntax.ts';

/** Tokenize only statically known Drizzle SQL templates. */
export function templateTokens(context: any, node: any) {
  if (!api(context, node.tag, 'sql')) return;

  const text = templateText(node.quasi);

  return text === undefined ? undefined : sqlTokens(text);
}
