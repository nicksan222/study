import { defineRule } from 'vite-plus/lint/plugins';

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');

    if (
      !/\/(?:apps\/server|packages\/contracts)\/src\//.test(path) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\//.test(path)
    )
      return {};

    function check(node: any) {
      const inner = node.expression;

      if (
        (inner?.type === 'TSAsExpression' || inner?.type === 'TSTypeAssertion') &&
        ['TSUnknownKeyword', 'TSAnyKeyword'].includes(inner.typeAnnotation.type)
      )
        context.report({ node, message: 'Do not bypass type checking with a double assertion.' });
    }

    return { TSAsExpression: check, TSTypeAssertion: check };
  }
});
