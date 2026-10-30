import { binding, imported, property, typedOwner } from './synchronous-transactions.ts';

const sources = /^(?:@study\/db(?:\/.*)?|drizzle-orm(?:\/.*)?)$/;

export function api(context: any, node: any, name: string, seen = new Set<any>()): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);
  const valueImport = (target: any, importedName?: string): boolean => {
    if (!imported(context, target, sources, importedName)) return false;

    const specifier = binding(context, target)?.defs[0]?.node;

    return specifier?.importKind !== 'type' && specifier?.parent?.importKind !== 'type';
  };

  if (valueImport(node, name)) return true;

  if (property(node) === name && valueImport(node.object)) return true;

  const def = binding(context, node)?.defs[0]?.node;

  return (
    def?.type === 'VariableDeclarator' &&
    def.parent?.kind === 'const' &&
    api(context, def.init, name, seen)
  );
}

export function databaseOrm(context: any, node: any, seen = new Set<any>()): boolean {
  if (!node || seen.has(node)) return false;

  seen.add(node);

  if (property(node) === 'orm' && typedOwner(context, node)) return true;

  const declaration = binding(context, node)?.defs[0]?.node;

  return declaration?.type === 'VariableDeclarator' && declaration.parent?.kind === 'const'
    ? databaseOrm(context, declaration.init, seen)
    : false;
}

export function chain(
  context: any,
  node: any,
  seen = new Set<any>()
): { methods: { name: string; args: any[] }[]; owner: any } | undefined {
  if (!node || seen.has(node)) return;

  seen.add(node);

  if (node.type === 'Identifier') {
    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'VariableDeclarator' && def.parent?.kind === 'const')
      return chain(context, def.init, seen);

    return;
  }

  if (node.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return;

  const name = property(node.callee);

  if (!name) return;

  const previous = chain(context, node.callee.object, seen);

  if (previous)
    return { ...previous, methods: [...previous.methods, { name, args: node.arguments }] };

  if (
    ['select', 'insert', 'update', 'delete'].includes(name) &&
    databaseOrm(context, node.callee.object)
  )
    return { owner: node.callee.object, methods: [{ name, args: node.arguments }] };
}

// Keep strings and quoted identifiers opaque so keywords inside them cannot change clauses.
export function sqlTokens(text: string): string[] {
  const tokens: string[] = [];
  const re =
    /(--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]]|\]\])*\])|([a-zA-Z_][\w$]*|\d+(?:\.\d+)?|!=|<>|>=|<=|=|[(),;.])/g;

  for (const match of text.matchAll(re)) {
    if (match[1]) continue;

    if (match[2]) tokens.push('__QUOTED__');
    else if (match[3]) tokens.push(match[3].toUpperCase());
  }

  return tokens;
}

export function templateText(node: any): string | undefined {
  if (node?.type !== 'TemplateLiteral') return;

  return node.quasis.map((part: any) => part.value.raw).join(' __VALUE__ ');
}

export function sqlStatements(tokens: string[]): string[][] {
  const statements: string[][] = [[]];
  let depth = 0;

  for (const token of tokens) {
    if (token === '(') depth++;

    if (token === ')') depth--;

    if (token === ';' && depth === 0) statements.push([]);
    else statements.at(-1)!.push(token);
  }

  return statements.filter((statement) => statement.length);
}

export function statementKind(tokens: string[]): string | undefined {
  let depth = 0;

  for (const token of tokens) {
    if (token === '(') depth++;
    else if (token === ')') depth--;
    else if (!depth && ['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token))
      return token;
  }
}

export function topLevelWhere(tokens: string[]): string[] | undefined {
  let depth = 0;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === '(') depth++;
    else if (token === ')') depth--;
    else if (!depth && token === 'WHERE') return tokens.slice(index + 1);
  }
}

export function trivialPredicate(tokens: string[]): boolean {
  let end = tokens.findIndex((token) => ['RETURNING', 'ORDER', 'LIMIT'].includes(token));

  if (end < 0) end = tokens.length;

  let predicate = tokens.slice(0, end);

  while (predicate[0] === '(' && predicate.at(-1) === ')') {
    let depth = 0;
    const closing = predicate.findIndex((token) => {
      if (token === '(') depth++;

      if (token === ')') depth--;

      return depth === 0;
    });

    if (closing !== predicate.length - 1) break;

    predicate = predicate.slice(1, -1);
  }

  let depth = 0;

  for (let index = 0; index < predicate.length; index++) {
    const token = predicate[index];

    if (token === '(') depth++;
    else if (token === ')') depth--;
    else if (depth === 0 && token === 'OR')
      return (
        trivialPredicate(predicate.slice(0, index)) || trivialPredicate(predicate.slice(index + 1))
      );
  }

  return (
    !predicate.length ||
    predicate.join(' ') === 'TRUE' ||
    predicate.join(' ') === '1' ||
    predicate.join(' ') === '1 = 1'
  );
}

/** Recognize only top-level assignment operators; comparisons inside their values remain checked. */
export function nullComparison(tokens: string[]): boolean {
  let depth = 0;
  let set = false;
  let start = 0;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === '(') depth++;
    else if (token === ')') depth--;

    if (!depth && token === 'SET') {
      set = true;
      start = index + 1;
    }

    if (!depth && ['WHERE', 'RETURNING', ';'].includes(token)) set = false;

    if (!depth && set && token === ',') start = index + 1;

    if (
      !['=', '!=', '<>'].includes(token) ||
      (tokens[index + 1] !== 'NULL' && tokens[index - 1] !== 'NULL')
    )
      continue;

    const lhs = tokens.slice(start, index);
    const assignment =
      token === '=' &&
      !depth &&
      set &&
      (lhs.length === 1 || (lhs.length === 3 && lhs[1] === '.')) &&
      lhs.every((part) => part === '.' || /^[A-Z_][A-Z_0-9$]*$/.test(part));

    if (!assignment) return true;
  }

  return false;
}
