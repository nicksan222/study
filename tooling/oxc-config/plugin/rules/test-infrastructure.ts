/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep test resources, waiting and runner policy in shared tooling.                  │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents local process ownership, sleep-based waiting, temporary shell resources and     │
 * │ runner configuration in tests. Shared testing owners are exempt; runner imports and      │
 * │ custom test namespace wrappers are restricted beyond test files too.                     │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   // example.test.ts                                                                     │
 * │   import { test } from '@study/testing';                                                 │
 * │   test.spawnTestProcess(['bun', 'server.ts']);                                           │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   // example.test.ts                                                                     │
 * │   Bun.spawn(['bun', 'server.ts']);                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { defineRule } from 'vite-plus/lint/plugins';

import { importedValue, moduleEdges } from '../architecture-imports.ts';
import { binding, imported, memberName, nestedRegistration } from '../lexical-bindings.ts';
import { bunOperation, namespaceImport } from '../process-operations.ts';
import { resolveValue } from './module-factories.ts';

function importedCall(context: any, node: any, source: RegExp, name: string): boolean {
  const value = resolveValue(context, node);

  return Boolean(
    value &&
    (imported(context, value, source, name) ||
      (memberName(value) === name &&
        namespaceImport(context, resolveValue(context, value.object), source)))
  );
}

function localPolicy(context: any, node: any): boolean {
  if (importedCall(context, node, /^@testing-library\/(?:react|dom)$/, 'configure')) return true;

  const callee = resolveValue(context, node);

  return (
    callee?.type === 'MemberExpression' &&
    memberName(callee) === 'setConfig' &&
    importedCall(context, callee.object, /^(?:vite-plus\/test|vitest)$/, 'vi')
  );
}

function insideLoop(node: any): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      [
        'WhileStatement',
        'DoWhileStatement',
        'ForStatement',
        'ForOfStatement',
        'ForInStatement'
      ].includes(parent.type)
    )
      return true;

    if (
      ['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(parent.type)
    )
      return false;
  }

  return false;
}

function effectServiceCall(context: any, node: any): boolean {
  const operation = importedValue(context, node);

  return (
    operation?.source === 'effect' &&
    ['Effect.runPromise', 'Effect.runSync', 'Effect.provide'].includes(operation.name)
  );
}

function fileSystemService(context: any, node: any): boolean {
  const value = resolveValue(context, node);

  if (['YieldExpression', 'AwaitExpression'].includes(value?.type))
    return fileSystemService(context, value.argument);

  const reference = importedValue(context, value);

  if (reference?.source === 'effect' && reference.name === 'FileSystem.FileSystem') return true;

  if (value?.type !== 'CallExpression') return false;

  return effectServiceCall(context, value.callee) && fileSystemService(context, value.arguments[0]);
}

function temporaryStorage(context: any, node: any): boolean {
  const call = resolveValue(context, node);

  return (
    ['makeTempDirectory', 'makeTempDirectoryScoped'].includes(memberName(call) ?? '') &&
    fileSystemService(context, call.object)
  );
}

function canonicalTestBody(registration: any): boolean {
  return (
    registration?.source === '@study/testing' &&
    /^test\.(?:stable|regression|migration|characterization)(?:\.|$)/.test(registration.name)
  );
}

function callbackOwner(node: any): any {
  let owner = node.parent;

  while (
    owner &&
    !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(owner.type)
  )
    owner = owner.parent;

  return owner;
}

function registrationCallee(owner: any): any {
  if (owner?.parent?.type !== 'CallExpression') return undefined;

  let callee = owner.parent.callee;
  const invokedBuilder = callee?.type === 'CallExpression';

  while (callee?.type === 'CallExpression') callee = callee.callee;

  return invokedBuilder && memberName(callee) === 'extend' ? callee.object : callee;
}

function directTestBody(context: any, node: any): boolean {
  const callee = registrationCallee(callbackOwner(node));

  if (!callee) return false;

  const registration = importedValue(context, callee);

  return canonicalTestBody(registration);
}

function disposableFixture(context: any, node: any): boolean {
  const value = importedValue(context, node);

  return Boolean(
    value?.name === 'createTestDatabase' ||
    ['createServerFixture', 'createRpcFixture', 'createServerTest'].includes(value?.name ?? '') ||
    (value?.source === '@study/db' && value.name === 'Db.open') ||
    (value?.source?.includes('server') && value.name === 'App.open')
  );
}

function directTestFixtureApi(context: any, node: any): boolean {
  const value = importedValue(context, node);

  return (
    value?.source === '@study/testing' &&
    ['test.createTestDatabase', 'test.createServerFixture', 'test.createRpcFixture'].includes(
      value.name
    )
  );
}

function fixtureOwnerPath(path: string): boolean {
  return (
    /\/(?:packages\/db\/src\/testing\.ts|packages\/testing\/src\/vitest\.ts|apps\/server\/test\/testing\/(?:fixture|scenarios|fixture\.test|automatic-fixture-scenario)\.ts|tooling\/testing\/(?:resources|process)\.ts)$/.test(
      path
    ) ||
    path.endsWith('/packages/db/test/scenarios.ts') ||
    path.endsWith('/packages/db/test/setup.ts')
  );
}

function fixtureSubjectPath(path: string): boolean {
  return (
    path.endsWith('/packages/db/test/testing.test.ts') ||
    path.endsWith('/packages/db/test/db.test.ts') ||
    path.endsWith('/packages/db/test/snapshot-reference.test.ts') ||
    path.endsWith('/packages/db/test/pages.test.ts') ||
    path.endsWith('/apps/server/test/server/database-ownership.test.ts') ||
    path.endsWith('/packages/testing/test/resources.test.ts') ||
    path.endsWith('/packages/testing/test/process.test.ts') ||
    path.endsWith('/packages/testing/test/react.test.ts') ||
    path.endsWith('/packages/testing/test/vitest.test.ts')
  );
}

function testApiOwnerPath(path: string): boolean {
  return (
    path.includes('/packages/testing/src/') ||
    (path.includes('/tooling/testing/') && !actualTestFile(path)) ||
    path.endsWith('/packages/db/test/scenarios.ts') ||
    path.endsWith('/packages/db/test/setup.ts') ||
    path.endsWith('/apps/client/src/test/scenarios.tsx') ||
    path.endsWith('/apps/client/src/test/setup.ts') ||
    /\/apps\/client\/test\/e2e\/harness\/(?:index|testing)\.ts$/.test(path) ||
    /\/apps\/server\/test\/testing\/(?:fixture|scenarios|fixture\.test|automatic-fixture-scenario|setup)\.ts$/.test(
      path
    ) ||
    fixtureSubjectPath(path)
  );
}

function actualTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function privateTestFacet(source: string | null): boolean {
  return (
    source !== null &&
    (source.startsWith('@testing-library/') ||
      /^@study\/[^/]+\/(?:[^/]+\/)*testing(?:\/|$)/.test(source) ||
      source.startsWith('@study/testing/'))
  );
}

function appSourceFixtureFacet(path: string, isTest: boolean, source: string | null): boolean {
  return (
    source !== null &&
    !isTest &&
    path.includes('/src/') &&
    /^@study\/(?:contracts\/(?:react\/)?testing|server\/testing|db\/testing)$/.test(source)
  );
}

function forbiddenTestHelperImport(
  isTest: boolean,
  fixtureOwner: boolean,
  source: string | null
): boolean {
  return (
    source !== null &&
    isTest &&
    !fixtureOwner &&
    /^(?:@testing-library\/(?:react|dom|user-event)|#client\/test\/(?:render-page|render-in-router)(?:\.[jt]sx?)?)$/.test(
      source
    )
  );
}

function forbiddenTestFacetImport(
  isTest: boolean,
  owner: boolean,
  typeOnly: boolean,
  source: string | null
): boolean {
  return isTest && !owner && !typeOnly && privateTestFacet(source);
}

function runnerConfigurationImport(typeOnly: boolean, source: string | null): boolean {
  return !typeOnly && source !== null && /^(?:vite-plus\/test\/node|vitest\/node)$/.test(source);
}

function checkFixtureOwnership(context: any, node: any): void {
  if (!disposableFixture(context, node.callee) || !directTestBody(context, node)) return;

  const declaration = node.parent?.type === 'AwaitExpression' ? node.parent.parent : node.parent;

  if (
    declaration?.type !== 'VariableDeclarator' ||
    declaration.parent.type !== 'VariableDeclaration' ||
    declaration.parent.kind !== 'await using'
  )
    context.report({ node, messageId: 'ownership' });
}

function checkObservation(context: any, node: any, operation: string | undefined): void {
  const value = importedValue(context, node.callee);
  const effectSleep = value?.source === 'effect' && value.name === 'Effect.sleep';

  if (operation === 'sleep' || (effectSleep && insideLoop(node)))
    context.report({ node, messageId: 'polling' });
}

function checkResources(context: any, node: any): void {
  const operation = bunOperation(context, node.callee);

  if (operation === 'spawn' || operation === 'spawnSync' || temporaryStorage(context, node.callee))
    context.report({ node, messageId: 'resource' });

  checkObservation(context, node, operation);
}

function checkPublicExpectation(context: any, node: any): void {
  const called = importedValue(context, node.callee);

  if (
    ((called?.source === '@study/testing' && called.name === 'test.expect') ||
      isFixtureHelperCall(context, node, 'expect')) &&
    node.arguments.length > 2
  )
    context.report({ node, messageId: 'expectArguments' });
}

function checkNestedRegistration(context: any, node: any): void {
  const registration = importedValue(context, node.callee);

  if (
    registration?.source === '@study/testing' &&
    registration.name === 'test.stable' &&
    nestedRegistration(node)
  )
    context.report({ node, messageId: 'registration' });
}

function checkTestCall(context: any, node: any, isTest: boolean, fixtureOwner: boolean): void {
  if (!isTest) return;

  const operation = importedValue(context, node.callee);

  if (
    operation?.source === '@study/testing' &&
    /^test\.(?:vi\.)?(?:mock|doMock|unmock|doUnmock|hoisted|resetModules)$/.test(operation.name)
  )
    context.report({ node, messageId: 'scopedMock' });

  if (
    !fixtureOwner &&
    (disposableFixture(context, node.callee) || directTestFixtureApi(context, node.callee))
  )
    context.report({ node, messageId: 'fixtureAcquisition' });

  checkFixtureOwnership(context, node);
  checkResources(context, node);

  if (localPolicy(context, node.callee)) context.report({ node, messageId: 'policy' });
}

function mockFixtureParameter(context: any, callback: any): any | undefined {
  const registration = importedValue(context, registrationCallee(callback));
  const index = registration?.name.endsWith('.for') ? 1 : 0;

  return callback.params?.[index];
}

function callbackForTest(context: any, node: any): any | undefined {
  for (let owner = node.parent; owner; owner = owner.parent) {
    if (
      !['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(owner.type)
    )
      continue;

    const registration = importedValue(context, registrationCallee(owner));

    if (canonicalTestBody(registration) || registration?.name === 'test.beforeEach') return owner;
  }

  return undefined;
}

function patternProvidesFixture(context: any, pattern: any, variable: any, name: string): boolean {
  return (
    pattern?.type === 'ObjectPattern' &&
    pattern.properties.some(
      (property: any) =>
        property.type === 'Property' &&
        (property.key.name ?? property.key.value) === name &&
        property.value.type === 'Identifier' &&
        binding(context, property.value) === variable
    )
  );
}

function followsFixtureAlias(
  context: any,
  declaration: any,
  parameter: any,
  name: string,
  seen: Set<any>
): boolean {
  return (
    declaration.id.type === 'Identifier' &&
    declaration.init?.type === 'Identifier' &&
    bindingProvidesFixture(context, declaration.init, parameter, name, seen)
  );
}

function destructuresFixture(
  context: any,
  declaration: any,
  parameter: any,
  variable: any,
  name: string
): boolean {
  if (parameter?.type !== 'Identifier' || declaration.id.type !== 'ObjectPattern') return false;

  return (
    declaration.init?.type === 'Identifier' &&
    binding(context, declaration.init) === binding(context, parameter) &&
    patternProvidesFixture(context, declaration.id, variable, name)
  );
}

function fixtureAliasDefinition(
  context: any,
  definition: any,
  parameter: any,
  variable: any,
  name: string,
  seen: Set<any>
): boolean {
  const declaration = definition.node;

  if (declaration?.type !== 'VariableDeclarator') return false;

  return (
    followsFixtureAlias(context, declaration, parameter, name, seen) ||
    destructuresFixture(context, declaration, parameter, variable, name)
  );
}

function bindingProvidesFixture(
  context: any,
  identifier: any,
  parameter: any,
  name: string,
  seen = new Set<any>()
): boolean {
  const variable = binding(context, identifier);

  if (!variable || seen.has(variable)) return false;

  seen.add(variable);

  return (
    patternProvidesFixture(context, parameter, variable, name) ||
    (variable.defs ?? []).some((definition: any) =>
      fixtureAliasDefinition(context, definition, parameter, variable, name, seen)
    )
  );
}

function isFixtureHelperCall(context: any, node: any, name: string): boolean {
  const callback = callbackForTest(context, node);

  if (!callback) return false;

  const parameter = mockFixtureParameter(context, callback);

  if (node.callee.type === 'Identifier')
    return bindingProvidesFixture(context, node.callee, parameter, name);

  return (
    node.callee.type === 'MemberExpression' &&
    memberName(node.callee) === name &&
    node.callee.object.type === 'Identifier' &&
    parameter?.type === 'Identifier' &&
    binding(context, parameter) === binding(context, node.callee.object)
  );
}

function runtimeImport(node: any): boolean {
  return (
    node.importKind !== 'type' &&
    (node.specifiers.length === 0 ||
      node.specifiers.some((specifier: any) => specifier.importKind !== 'type'))
  );
}

function mockTarget(node: any): string | undefined {
  const argument = node.arguments[0];

  if (argument?.type === 'Literal' && typeof argument.value === 'string') return argument.value;

  if (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0)
    return argument.quasis[0]?.value.cooked;

  return undefined;
}

const testNamespaceMembers = new Set([
  'stable',
  'regression',
  'migration',
  'characterization',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'describe'
]);

function testNamespace(context: any, node: any): boolean {
  const value = importedValue(context, node);

  return value?.source === '@study/testing' && value.name === 'test';
}

function checkTestNamespaceMember(context: any, node: any): void {
  if (!testNamespace(context, node.object)) return;

  const member = memberName(node);

  if (member && !testNamespaceMembers.has(member))
    context.report({ node, messageId: 'testHelperFixture' });
}

function checkTestNamespaceDestructure(context: any, node: any): void {
  if (node.id?.type !== 'ObjectPattern' || !testNamespace(context, node.init)) return;

  for (const property of node.id.properties) {
    if (property.type === 'RestElement') {
      context.report({ node: property, messageId: 'opaqueTestFixtures' });

      continue;
    }

    if (property.type !== 'Property') continue;

    const member = property.key.name ?? property.key.value;

    if (typeof member === 'string' && !testNamespaceMembers.has(member))
      context.report({ node: property, messageId: 'testHelperFixture' });
  }
}

function hasRestProperty(pattern: any): boolean {
  return (
    pattern?.type === 'ObjectPattern' &&
    pattern.properties.some((property: any) => property.type === 'RestElement')
  );
}

function checkOpaqueFixtureParameter(context: any, node: any): void {
  const registration = importedValue(context, registrationCallee(node));

  if (!canonicalTestBody(registration) && registration?.name !== 'test.beforeEach') return;

  const parameter = mockFixtureParameter(context, node);

  if (hasRestProperty(parameter))
    context.report({ node: parameter, messageId: 'opaqueTestFixtures' });
}

function checkOpaqueFixtureSpread(context: any, node: any): void {
  if (testNamespace(context, node.argument)) {
    context.report({ node, messageId: 'opaqueTestFixtures' });

    return;
  }

  const callback = callbackForTest(context, node);
  const parameter = callback && mockFixtureParameter(context, callback);

  if (
    node.argument.type === 'Identifier' &&
    parameter?.type === 'Identifier' &&
    binding(context, node.argument) === binding(context, parameter)
  )
    context.report({ node, messageId: 'opaqueTestFixtures' });
}

export default defineRule({
  meta: {
    type: 'problem',
    messages: {
      resource:
        'Use @study/testing resource and process helpers; Vitest owns processes through @study/testing/vitest.',
      fixtureImport:
        'Use the test namespace for application test setup and helpers; reserve testing facets for their owners.',
      fixtureAcquisition:
        'Acquire database and server test resources through lazy test callback fixtures, not direct constructors or namespace helpers.',
      ownership:
        'Acquire disposable fixtures with await using so failed setup and assertions release their resources.',
      polling:
        'Use native waitFor or expect.poll through the shared testing policy, not sleep loops.',
      policy:
        'Configure test runners and async budgets in the shared testing tooling, not individual tests.',
      runner: 'Test runners belong in tooling/testing; author ordinary tests with @study/testing.',
      registration:
        'Use the provided test registrations and native each/extend APIs instead of a custom test wrapper.',
      expectArguments:
        'Pass at most an assertion subject and one diagnostic message to the callback expect fixture.',
      scopedMock:
        'Request mock through the test callback parameters, register the mock there, and dynamically import its subject. Module mocks must not use test.mock, hoisting, or test.vi.',
      staticMockSubject:
        'A subject registered with the callback mock fixture must be dynamically imported after mock registration, not statically imported.',
      testHelperFixture:
        'Request test-body helpers through callback fixture parameters; reserve the test namespace for registrations, hooks, classification and describe.',
      opaqueTestFixtures:
        'Do not collect test fixture helpers through an opaque rest or spread; destructure each required helper explicitly.'
    }
  },
  create(context) {
    const path = context.filename.replaceAll('\\', '/');
    const actualTest = actualTestFile(path);
    const owner =
      /\/packages\/testing\/src\//.test(path) || (/\/tooling\/testing\//.test(path) && !actualTest);
    const fixtureOwner = fixtureOwnerPath(path);
    const test =
      /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests)\/(?:testing|support|fixtures)(?:\/|[.])|\/src\/(?:test|testing)\/|\/test\/e2e\/harness\/|test-(?:support|utils|helper)s?/.test(
        path
      );
    const enforceTestHelperFixture = test && !testApiOwnerPath(path) && !fixtureSubjectPath(path);
    const staticImports = new Map<string, any[]>();

    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== 'ImportDeclaration' || !runtimeImport(statement)) continue;

      const source = statement.source.value;
      const imports = staticImports.get(source) ?? [];

      imports.push(statement);
      staticImports.set(source, imports);
    }

    const reportedStaticImports = new Set<any>();

    if (owner) return {};

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (appSourceFixtureFacet(path, test, source))
        context.report({ node, messageId: 'fixtureImport' });

      if (
        forbiddenTestHelperImport(
          actualTest,
          fixtureOwner || testApiOwnerPath(path) || fixtureSubjectPath(path),
          source
        )
      )
        context.report({ node, messageId: 'fixtureImport' });

      if (
        forbiddenTestFacetImport(
          actualTest,
          testApiOwnerPath(path) || fixtureSubjectPath(path),
          typeOnly,
          source
        )
      )
        context.report({ node, messageId: 'fixtureImport' });

      if (runnerConfigurationImport(typeOnly, source))
        context.report({ node, messageId: 'runner' });
    });

    return {
      ...edges,
      MemberExpression(node) {
        if (enforceTestHelperFixture) checkTestNamespaceMember(context, node);
      },
      ArrowFunctionExpression(node) {
        if (enforceTestHelperFixture) checkOpaqueFixtureParameter(context, node);
      },
      FunctionExpression(node) {
        if (enforceTestHelperFixture) checkOpaqueFixtureParameter(context, node);
      },
      SpreadElement(node) {
        if (enforceTestHelperFixture) checkOpaqueFixtureSpread(context, node);
      },
      VariableDeclarator(node) {
        if (enforceTestHelperFixture) checkTestNamespaceDestructure(context, node);
      },
      CallExpression(node) {
        edges.CallExpression(node);
        checkPublicExpectation(context, node);
        checkNestedRegistration(context, node);
        checkTestCall(context, node, actualTest, fixtureOwner || fixtureSubjectPath(path));

        if (!actualTest || !isFixtureHelperCall(context, node, 'mock')) return;

        const source = mockTarget(node);

        if (!source) return;

        for (const statement of staticImports.get(source) ?? []) {
          if (reportedStaticImports.has(statement)) continue;

          reportedStaticImports.add(statement);
          context.report({ node: statement, messageId: 'staticMockSubject' });
        }
      },
      TaggedTemplateExpression(node) {
        if (
          test &&
          /\bmktemp\b/.test(node.quasi.quasis.map((part: any) => part.value.cooked ?? '').join(' '))
        )
          context.report({ node, messageId: 'resource' });
      }
    };
  }
});
