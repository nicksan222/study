import {
  binding,
  imported,
  memberName as property,
  constantDeclarator,
  runtimeImport,
  enterNode,
  destructuredBinding
} from '../lexical-bindings.ts';
import { resolveValue } from './module-factories.ts';
import { typedOwner } from './synchronous-transactions.ts';

const names: Record<string, string> = {
  reactiveGeneration: 'reactive_generation',
  reactiveRevisions: 'reactive_revisions',
  workflowEvents: 'workflow_events',
  workflowReceipts: 'workflow_receipts'
};

export function persistenceWriters(context: any, report: (node: any, table: string) => void) {
  const source = (def: any, sql = false) =>
    runtimeImport(def) &&
    (sql ? /^(?:@study\/db(?:\/schema)?|drizzle-orm(?:\/.*)?)$/ : /^@study\/db(?:\/schema)?$/).test(
      def.parent.source.value
    );

  function importedName(node: any, sql = false, seen = new Set<any>()): string | undefined {
    if (!enterNode(node, seen)) return;

    if (
      [
        'TSAsExpression',
        'TSSatisfiesExpression',
        'TSNonNullExpression',
        'ParenthesizedExpression',
        'TSTypeAssertion'
      ].includes(node.type)
    )
      return importedName(node.expression, sql, seen);

    if (node.type === 'MemberExpression') return namespaceMember(node, sql);

    if (node.type !== 'Identifier') return;

    const def = binding(context, node)?.defs[0]?.node;

    if (def?.type === 'ImportSpecifier' && source(def, sql))
      return def.imported.name ?? def.imported.value;

    return aliasedName(node, def, sql, seen);
  }

  function namespaceMember(node: any, sql: boolean): string | undefined {
    const object = resolveValue(context, node.object);
    const def = binding(context, object)?.defs[0]?.node;

    return def?.type === 'ImportNamespaceSpecifier' && source(def, sql)
      ? property(node)
      : undefined;
  }

  function aliasedName(node: any, def: any, sql: boolean, seen: Set<any>): string | undefined {
    if (!constantDeclarator(def)) return;

    if (def.id.type === 'ObjectPattern') {
      const prop = destructuredBinding(def.id, node.name);
      const object = resolveValue(context, def.init);
      const namespace = binding(context, object)?.defs[0]?.node;

      if (prop && namespace?.type === 'ImportNamespaceSpecifier' && source(namespace, sql))
        return prop.computed ? prop.key.value : (prop.key.name ?? prop.key.value);

      return;
    }

    return importedName(def.init, sql, seen);
  }

  const tableName = (node: any) => {
    const name = importedName(node);

    return name ? (names[name] ?? name) : undefined;
  };
  const isSql = (node: any) => importedName(node, true) === 'sql';

  function databaseReceiver(node: any, seen = new Set<any>()): boolean {
    if (!enterNode(node, seen)) return false;

    if (typedOwner(context, node)) return true;

    if (node.type === 'MemberExpression') return databaseReceiver(node.object, seen);

    if (node.type === 'CallExpression' && property(node.callee) === 'prepare')
      return databaseReceiver(node.callee.object, seen);

    const def = binding(context, node)?.defs[0]?.node;

    if (databaseAnnotation(node, def)) return true;

    return constantDeclarator(def) ? databaseReceiver(def.init, seen) : false;
  }

  function databaseAnnotation(node: any, def: any): boolean {
    const annotation =
      def?.type === 'VariableDeclarator'
        ? def.id.typeAnnotation?.typeAnnotation
        : binding(context, node)?.defs[0]?.name?.typeAnnotation?.typeAnnotation;

    if (
      annotation?.type === 'TSTypeReference' &&
      imported(context, annotation.typeName, /(?:^@study\/db$|platform\/database\/context$)/)
    )
      return true;

    return false;
  }

  function sqlWrites(node: any, text: string, expressions: any[] = []) {
    for (const target of sqlTargetTokens(text, false)) reportTable(node, target, expressions);
  }

  function reportTable(node: any, target: string | undefined, expressions: any[]) {
    const token = target?.replace(/^@/, '');
    const interpolation = /^__interpolation_(\d+)__$/.exec(token ?? '');
    const table = interpolation ? tableName(expressions[Number(interpolation[1])]) : token;

    if (table) report(node, table);
  }

  function inspectLiteral(node: any, value: any) {
    const resolved = resolveValue(context, value);

    if (resolved?.type === 'Literal' && typeof resolved.value === 'string')
      sqlWrites(node, resolved.value);
    else if (resolved?.type === 'TemplateLiteral' && resolved.expressions.length === 0)
      sqlWrites(node, resolved.quasis[0].value.cooked);
  }

  return {
    CallExpression(node: any) {
      const method = property(node.callee);

      if (
        ['insert', 'update', 'delete'].includes(method ?? '') &&
        databaseReceiver(node.callee.object)
      ) {
        const table = tableName(node.arguments[0]);

        if (table) report(node, table);
      }

      if (
        (method === 'raw' && isSql(node.callee.object)) ||
        (['exec', 'execute', 'prepare', 'run', 'all', 'get'].includes(method ?? '') &&
          databaseReceiver(node.callee.object))
      )
        inspectLiteral(node, node.arguments[0]);
    },
    TaggedTemplateExpression(node: any) {
      if (!isSql(node.tag)) return;

      const text = node.quasi.quasis
        .map(
          (part: any, i: number) =>
            (part.value.cooked ?? part.value.raw) +
            (i < node.quasi.expressions.length ? ` __INTERPOLATION_${i}__ ` : '')
        )
        .join('');

      sqlWrites(node, text, node.quasi.expressions);
    }
  };
}

function sqlTokens(text: string): string[] {
  // Keep string values opaque, but retain quoted identifiers and interpolation positions.
  const re =
    /(--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)|('(?:''|[^'])*')|("(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:[^\]]|\]\])*\])|(__INTERPOLATION_\d+__|[a-zA-Z_][\w$]*|[(),.;])/g;
  const tokens: string[] = [];

  for (const match of text.matchAll(re)) {
    if (match[1]) continue;

    if (match[2]) tokens.push('__STRING__');
    else if (match[3])
      tokens.push(
        '@' +
          match[3]
            .slice(1, -1)
            .replaceAll(
              match[3][0] === '[' ? ']]' : match[3][0].repeat(2),
              match[3][0] === '[' ? ']' : match[3][0]
            )
            .toLowerCase()
      );
    else tokens.push(match[4].toLowerCase());
  }

  return tokens;
}

function mutationTarget(tokens: string[], i: number, word: string): number | null {
  let at = i + 1;

  if (word === 'insert' || word === 'replace') {
    if (tokens[at] === 'or') at += 2;

    if (tokens[at++] !== 'into') return null;
  } else if (word === 'update') {
    if (tokens[at] === 'or') at += 2;
  } else if (word === 'delete') {
    if (tokens[at++] !== 'from') return null;
  } else return null;

  if (tokens[at + 1] === '.') at += 2;

  return at;
}

function bracketDepth(word: string): number {
  if (word === '(') return 1;

  if (word === ')') return -1;

  return 0;
}

function statementStart(tokens: string[], i: number): boolean {
  return (
    ['select', 'insert', 'replace', 'update', 'delete'].includes(tokens[i]) &&
    !['as', ',', '('].includes(tokens[i + 1])
  );
}

/** SQL mutation identifiers, including infrastructure DDL; values and comments stay opaque. */
export function sqlMutationTargets(text: string): string[] {
  return [...sqlTargetTokens(text, true)].map((target) => target.replace(/^@/, ''));
}

function* statementOperations(tokens: string[]) {
  let depth = 0;
  let consumed = false;
  let triggerHeader = false;

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];

    depth += bracketDepth(word);

    if (word === 'begin' && triggerHeader && depth === 0) {
      consumed = false;
      triggerHeader = false;
    }

    if (word === ';' && depth === 0) {
      consumed = false;
      triggerHeader = false;
      continue;
    }

    if (depth || consumed || !operationStart(tokens, i)) continue;

    consumed = true;
    triggerHeader = word === 'create' && tokens.slice(i + 1, i + 3).includes('trigger');
    yield i;
  }
}

function operationStart(tokens: string[], i: number) {
  return statementStart(tokens, i) || ['create', 'alter', 'drop'].includes(tokens[i]);
}

function* sqlTargetTokens(text: string, schema: boolean) {
  const tokens = sqlTokens(text);

  for (const i of statementOperations(tokens)) {
    const word = tokens[i];
    const targets =
      schema && ['create', 'alter', 'drop'].includes(word)
        ? schemaMutationTargets(tokens, i, word)
        : [mutationTarget(tokens, i, word)];

    for (const target of targets) if (target !== null && tokens[target]) yield tokens[target];
  }
}

function schemaMutationTargets(tokens: string[], i: number, word: string): number[] {
  let at = i + 1;

  if (['unique', 'temp', 'temporary', 'virtual'].includes(tokens[at])) at++;

  const kind = tokens[at++];

  if (!['table', 'index', 'trigger', 'view'].includes(kind)) return [];

  if (tokens[at] === 'if') at += tokens[at + 1] === 'not' ? 3 : 2;

  const targets = [tokens[at + 1] === '.' ? at + 2 : at];

  if (word === 'create' && ['index', 'trigger'].includes(kind)) {
    const end = tokens.indexOf(';', at);
    const on = tokens.indexOf('on', at);

    if (on !== -1 && (end === -1 || on < end))
      targets.push(tokens[on + 2] === '.' ? on + 3 : on + 1);
  }

  return targets;
}
