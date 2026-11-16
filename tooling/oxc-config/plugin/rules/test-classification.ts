/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Keep test classification visible at every registration.                            │
 * │                                                                                          │
 * │ Prevents:                                                                                │
 * │ Prevents raw, aliased, hidden or conditionally disabled test registrations outside the   │
 * │ canonical adapters. Classified factories require valid literal catalog metadata and      │
 * │ temporary coverage needs a meaningful removal condition.                                 │
 * │                                                                                          │
 * │ Allowed:                                                                                 │
 * │   import { test } from '@study/testing';                                                 │
 * │   test.unit.stable('reads a note', () => {});                                            │
 * │                                                                                          │
 * │ Rejected:                                                                                │
 * │   import { test } from 'vite-plus/test';                                                 │
 * │   test('reads a note', () => {});                                                        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { BunPath } from '@effect/platform-bun';
import { classificationLabel } from '@study/testing';
import { Effect, Path } from 'effect';
import { defineRule } from 'vite-plus/lint/plugins';

import { importedValue, moduleEdges } from '../architecture-imports.ts';
import {
  binding,
  constantDeclarator,
  enterNode,
  memberName,
  nestedRegistration
} from '../lexical-bindings.ts';

const { dirname, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const runners =
  /^(?:node:test|test|vitest|vite-plus\/test|playwright\/test|@playwright\/test|@jest\/globals|bun:test)$/;

const rawNames = new Set(['test', 'it', 'fit', 'xit', 'xtest', 'ftest']);

const classifications = new Set(['stable', 'regression', 'migration', 'characterization']);

const scenarioModules = new Set(['#client/test/scenarios.tsx', '#testing/scenarios']);

function scenarioEdgeRelevant(source: string): boolean {
  return scenarioModules.has(source);
}

const forbidden = new Set([
  'only',
  'skip',
  'todo',
  'skipIf',
  'runIf',
  'fails',
  'failing',
  'fail',
  'fixme'
]);

function workspaceRoot(filename: string): string {
  const marker = /\/(?:apps|packages|tooling)\//.exec(filename);

  return marker ? filename.slice(0, marker.index) : dirname(filename);
}

function adapterPath(filename: string): boolean {
  return [
    'packages/testing/src/vitest.ts',
    'packages/testing/src/mock.ts',
    'packages/testing/src/playwright.ts',
    'packages/testing/src/react/setup.ts',
    'apps/client/test/e2e/harness/index.ts',
    'vite.config.ts',
    'apps/client/playwright.config.ts'
  ].some((path) => filename === resolve(workspaceRoot(filename), path));
}

function testApiOwnerPath(filename: string): boolean {
  return (
    filename.includes('/packages/testing/src/') ||
    filename === resolve(workspaceRoot(filename), 'packages/testing/test/vitest.test.ts') ||
    databaseScenarioOwnerPath(filename) ||
    scenarioOwnerSource(filename) !== undefined ||
    browserTestOwnerPath(filename) ||
    filename === resolve(workspaceRoot(filename), 'apps/client/src/test/setup.ts') ||
    filename === resolve(workspaceRoot(filename), 'apps/server/test/testing/setup.ts')
  );
}

function browserTestOwnerPath(filename: string): boolean {
  return /\/apps\/client\/test\/e2e\/harness\/(?:index|testing|screenshots)\.ts$/.test(filename);
}

function databaseScenarioOwnerPath(filename: string): boolean {
  return (
    filename === resolve(workspaceRoot(filename), 'packages/db/test/scenarios.ts') ||
    filename === resolve(workspaceRoot(filename), 'packages/db/test/setup.ts')
  );
}

function typeContractPath(filename: string): boolean {
  return /\/packages\/testing\/test\/(?:api|vitest)\.types\.ts$/.test(filename);
}

function scenarioOwnerSource(filename: string): string | undefined {
  if (filename === resolve(workspaceRoot(filename), 'apps/client/src/test/scenarios.tsx'))
    return '#client/test/scenarios.tsx';

  if (filename === resolve(workspaceRoot(filename), 'apps/server/test/testing/scenarios.ts'))
    return '#testing/scenarios';

  return undefined;
}

function ownerPrivateTestImport(filename: string, source: string, localName: string): boolean {
  const scenarioOwner = scenarioOwnerSource(filename) !== undefined;
  const browserOwner = browserTestOwnerPath(filename);
  const coreTestOwner =
    filename === resolve(workspaceRoot(filename), 'packages/testing/test/vitest.test.ts');
  const databaseTestOwner = databaseScenarioOwnerPath(filename);

  return (
    (scenarioOwner || browserOwner || coreTestOwner || databaseTestOwner) &&
    source === '@study/testing/vitest' &&
    (localName === 'baseTest' || ((coreTestOwner || databaseTestOwner) && localName === 'test'))
  );
}

function publicTestImport(source: string): boolean {
  return source === '@study/testing';
}

const retiredNames = new Set([
  'testStable',
  'testReact',
  'testPage',
  'testServer',
  'testRpc',
  'testE2e',
  'testHarness',
  'testRegression',
  'testMigration',
  'testCharacterization'
]);

function invalidTestImport(source: string, filename: string, part: any): boolean {
  return (
    !allowedPrivateImport(source, filename, part) &&
    (isAliasedOrNonNamedImport(part) ||
      isExtraPublicFacadeImport(source, filename, part) ||
      isRetiredApi(part))
  );
}

function allowedPrivateImport(source: string, filename: string, part: any): boolean {
  return (
    source === '@study/testing/vitest' &&
    importName(part) === 'test' &&
    ownerPrivateTestImport(filename, source, part.local?.name)
  );
}

function isAliasedOrNonNamedImport(part: any): boolean {
  return part.type !== 'ImportSpecifier' || part.local.name !== importName(part);
}

function isExtraPublicFacadeImport(source: string, filename: string, part: any): boolean {
  return (
    source === '@study/testing' &&
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filename) &&
    !testApiOwnerPath(filename) &&
    importName(part) !== 'test'
  );
}

function isRetiredApi(part: any): boolean {
  return retiredNames.has(importName(part) ?? '');
}

function ownsScenarioExtension(filename: string, node: any): boolean {
  return isScenarioOwner(filename) && scenarioExtensionName(node);
}

function isScenarioOwner(filename: string): boolean {
  return scenarioOwnerSource(filename) !== undefined || databaseScenarioOwnerPath(filename);
}

function scenarioExtensionName(node: any): boolean {
  const declaration = node.parent?.type === 'VariableDeclarator' ? node.parent.id : undefined;
  const name = declaration?.type === 'Identifier' ? declaration.name : undefined;

  return name === 'runner' || name === 'test' || (name !== undefined && /^test[A-Z]/.test(name));
}

function scenarioExtensionBase(context: any, node: any): boolean {
  if (memberName(node?.callee) !== 'extend') return false;

  const base = importedValue(context, node.callee.object);

  return (
    (base?.source === '@study/testing' || base?.source === '@study/testing/vitest') &&
    (base.name === 'test.unit.stable' || base.name === 'baseTest.unit.stable')
  );
}

function storedScenarioExtension(context: any, filename: string, node: any): boolean {
  if (!scenarioExtensionBase(context, node)) return false;

  const declaration = node.parent?.type === 'VariableDeclarator' ? node.parent : undefined;

  if (!declaration || ownsScenarioExtension(filename, node)) return false;

  const name = declaration.id.type === 'Identifier' ? declaration.id.name : undefined;
  const isExported = declaration.parent?.parent?.type === 'ExportNamedDeclaration';
  const isNamedStarter = name !== undefined && /^test[A-Z]/.test(name);

  return isExported || isNamedStarter;
}

function localScenarioExtension(context: any, node: any): boolean {
  if (node?.type !== 'Identifier') return false;

  const declaration = binding(context, node)?.defs[0]?.node;

  return constantDeclarator(declaration) && scenarioExtensionBase(context, declaration.init);
}

function importName(node: any): string | undefined {
  return node.imported?.name ?? node.imported?.value ?? node.local?.name;
}

function rawImport(node: any): boolean {
  return node.specifiers.some(
    (specifier: any) =>
      specifier.importKind !== 'type' &&
      (specifier.type !== 'ImportSpecifier' || rawNames.has(importName(specifier)!))
  );
}

function immediateUse(node: any): boolean {
  const parent = node.parent;

  return (
    (parent?.type === 'CallExpression' && parent.callee === node) ||
    (parent?.type === 'MemberExpression' && parent.object === node)
  );
}

function stringLiteral(node: any): string | undefined {
  switch (node?.type) {
    case 'Literal':
      return typeof node.value === 'string' ? node.value : undefined;
    case 'TemplateLiteral':
      return node.expressions.length === 0 ? node.quasis[0]?.value.cooked : undefined;
    default:
      return undefined;
  }
}

function dynamicImportExpression(node: any): any {
  const expression = node?.type === 'AwaitExpression' ? node.argument : node;

  return expression?.type === 'ImportExpression' ? expression : undefined;
}

function dynamicImportSource(context: any, node: any): string | undefined {
  if (node?.type !== 'Identifier') return undefined;

  const declaration = binding(context, node)?.defs[0]?.node;
  const initializer = constantDeclarator(declaration) ? declaration.init : undefined;
  const expression = dynamicImportExpression(initializer);

  return stringLiteral(expression?.source);
}

function metadataValid(name: string, node: any): boolean {
  if (
    node?.type !== 'ObjectExpression' ||
    node.properties.some((part: any) => part.type !== 'Property' || part.computed)
  )
    return false;

  const fields = Object.fromEntries(
    node.properties.map((part: any) => [
      part.key.name ?? part.key.value,
      part.value.type === 'Literal' ? part.value.value : undefined
    ])
  );
  const kind: 'regression' | 'migration' | 'characterization' | undefined =
    name === 'regression' || name === 'migration' || name === 'characterization' ? name : undefined;

  if (!kind) return false;

  try {
    classificationLabel(kind, fields);

    return true;
  } catch {
    return false;
  }
}

function forbiddenOptions(node: any): boolean {
  return (
    node?.type === 'ObjectExpression' &&
    node.properties.some(
      (part: any) => part.type === 'Property' && forbidden.has(part.key.name ?? part.key.value)
    )
  );
}

export default defineRule({
  meta: { type: 'problem' },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');

    if (adapterPath(filename) || typeContractPath(filename)) return {};

    function report(
      node: any,
      message = 'Register tests with the canonical test namespace and classification.'
    ) {
      context.report({ node, message });
    }

    function adapterSource(source: string): boolean {
      return /^@study\/testing(?:\/vitest)?$/.test(source);
    }

    function adapterRegistration(source: string, name: string | undefined, definition: any) {
      if (name !== 'test' || importName(definition) !== 'test') return false;

      return (
        ownerPrivateTestImport(filename, source, definition.local.name) || publicTestImport(source)
      );
    }

    function approved(node: any, name?: string): boolean {
      const definition = binding(context, node)?.defs[0]?.node;

      if (definition?.type !== 'ImportSpecifier') return false;

      const declaration = definition.parent;

      if (declaration?.type !== 'ImportDeclaration') return false;

      const source = declaration.source.value;

      return adapterRegistration(source, name, definition);
    }

    function classification(node: any): boolean {
      if (!node) return false;

      const value = importedValue(context, node);

      if (!value || value.name.split('.').length !== 3) return false;

      const [rootName, environment, method] = value.name.split('.');

      return (
        rootName === 'test' &&
        ['unit', 'server', 'browser'].includes(environment!) &&
        classifications.has(method!) &&
        approved(root(node), 'test')
      );
    }

    function contextAnnotation(definition: any): boolean {
      const annotation = definition.name?.typeAnnotation?.typeAnnotation;

      if (annotation?.type !== 'TSTypeReference') return false;

      const specifier = binding(context, annotation.typeName)?.defs[0]?.node;

      return (
        /^(?:node:test|vitest|vite-plus\/test)$/.test(specifier?.parent?.source?.value ?? '') &&
        importName(specifier) === 'TestContext'
      );
    }

    function testContext(node: any, seen = new Set<any>()): boolean {
      if (!enterNode(node, seen) || node.type !== 'Identifier') return false;

      const definition = binding(context, node)?.defs[0];
      const declaration = definition?.node;

      if (constantDeclarator(declaration)) return testContext(declaration.init, seen);

      if (definition?.type !== 'Parameter') return false;

      if (contextAnnotation(definition)) return true;

      const parent = declaration.parent;

      return parent?.type === 'CallExpression' && classification(parent.callee);
    }

    function root(node: any): any {
      return node?.type === 'MemberExpression' ? root(node.object) : node;
    }

    function safeRunnerEdge(node: any): boolean {
      if (node.type === 'ImportDeclaration') return !rawImport(node);

      return (
        node.type === 'ExportNamedDeclaration' &&
        node.specifiers.every((part: any) => !rawNames.has(part.local.name))
      );
    }

    function adapterEdge(node: any, source: string): void {
      if (node.type !== 'ImportDeclaration') {
        report(
          node,
          'Import classified tests directly through their public alias; do not reexport or dynamically load registrations.'
        );

        return;
      }

      for (const part of node.specifiers) {
        if (invalidTestImport(source, filename, part))
          report(
            part,
            'Import classified test functions by their explicit names; aliases and namespaces hide their intent.'
          );
      }
    }

    function scenarioSourceEdge(node: any, source: string): boolean {
      if (!scenarioEdgeRelevant(source)) return false;

      if (scenarioOwnerSource(filename) !== undefined) return true;

      report(
        node,
        'Import test registrations from the public @study/testing facade, not scenario modules.'
      );

      return true;
    }

    function relativeAdapterEdge(node: any, source: string): boolean {
      const target = resolve(dirname(filename), source);
      const adapter = resolve(workspaceRoot(filename), 'packages/testing/src/index.ts');

      if (!source.startsWith('.') || target !== adapter) return false;

      report(
        node,
        'Import the public test API through @study/testing; relative paths are forbidden.'
      );

      return true;
    }

    function browserSourceEdge(node: any, source: string): boolean {
      if (source === '@study/testing/playwright') {
        if (browserTestOwnerPath(filename)) return false;

        report(
          node,
          'Import test registrations and helpers from the public @study/testing facade.'
        );

        return true;
      }

      return false;
    }

    function runnerSourceEdge(node: any, source: string): boolean {
      if (!runners.test(source)) return false;

      if (!safeRunnerEdge(node)) report(node);

      if (
        node.type === 'ImportDeclaration' &&
        node.specifiers.some((part: any) => part.importKind !== 'type')
      )
        report(
          node,
          'Import test registrations and helpers from the public @study/testing facade.'
        );

      return true;
    }

    function canonicalTestEdge(node: any, source: string): void {
      if (!adapterSource(source)) return;

      if (node.type !== 'ImportDeclaration') {
        report(node, 'Import the test namespace statically from @study/testing.');

        return;
      }

      if (
        !node.specifiers.some(
          (part: any) => part.type === 'ImportSpecifier' && importName(part) === 'test'
        )
      )
        return;

      const specifier = node.specifiers.find(
        (part: any) => part.type === 'ImportSpecifier' && importName(part) === 'test'
      );

      if (!adapterRegistration(source, 'test', specifier))
        report(node, 'Import the test namespace from the canonical owner for this test file.');
    }

    function privateApiEdge(node: any, source: string): void {
      if (source !== '@study/testing/vitest' || testApiOwnerPath(filename)) return;

      report(node, 'Import test registrations and helpers from the public @study/testing facade.');
    }

    const edges = moduleEdges(context, (node, source, typeOnly) => {
      if (!source || typeOnly) return;

      if (scenarioSourceEdge(node, source)) return;

      if (relativeAdapterEdge(node, source)) return;

      if (browserSourceEdge(node, source)) return;

      if (runnerSourceEdge(node, source)) return;

      if (adapterSource(source)) adapterEdge(node, source);

      canonicalTestEdge(node, source);
      privateApiEdge(node, source);
    });

    function factoryCall(node: any): void {
      if (node.callee.type !== 'MemberExpression') return;

      const value = importedValue(context, node.callee);
      const parts = value?.name.split('.');
      const kind = parts?.length === 3 ? parts[2] : undefined;

      if (
        !kind ||
        !classifications.has(kind) ||
        kind === 'stable' ||
        !approved(root(node.callee), 'test')
      )
        return;

      if (!immediateUse(node))
        report(
          node,
          'Apply classified factories directly at the test definition; do not hide registrations behind aliases.'
        );

      if (!metadataValid(kind, node.arguments[0]))
        report(
          node,
          'Use explicit literal metadata with a known catalog identifier, valid retention and a nonempty removal condition for temporary coverage.'
        );
    }

    function rawRegistration(owner: any): boolean {
      return owner?.type === 'Identifier' && rawNames.has(owner.name) && !binding(context, owner);
    }

    function invalidTestRegistration(owner: any): boolean {
      if (owner?.type !== 'Identifier' || owner.name !== 'test') return false;

      const definition = binding(context, owner)?.defs[0]?.node;

      return (
        definition?.type === 'ImportSpecifier' &&
        importName(definition) === 'test' &&
        !approved(owner, 'test')
      );
    }

    function ordinaryRegistrationCall(node: any, owner: any): void {
      if (rawRegistration(owner) || invalidTestRegistration(owner)) report(node);
    }

    function aliasedTestReference(node: any): boolean {
      if (insideTypeReference(node)) return false;

      const references = binding(context, node)?.references ?? [];
      const reference = references.some((part: any) => part.identifier === node);
      const directMember = node.parent?.type === 'MemberExpression' && node.parent.object === node;

      return reference && !directMember;
    }

    function insideTypeReference(node: any): boolean {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (['TSTypeQuery', 'TSTypeReference'].includes(parent.type)) return true;

        if (['Program', 'BlockStatement', 'ExpressionStatement'].includes(parent.type))
          return false;
      }

      return false;
    }

    function checkTestIdentifier(node: any): void {
      if (node.parent?.type === 'VariableDeclarator' && node.parent.id === node) return;

      if (node.name !== 'test' || !approved(node, 'test')) return;

      if (aliasedTestReference(node))
        report(node, 'Use the test namespace directly; do not alias or pass it around.');
    }

    function checkClassifiedMember(node: any): void {
      const value = importedValue(context, node);

      if (/^test\.(?:stable|regression|migration|characterization)(?:\.|$)/.test(value?.name ?? ''))
        report(node, 'Classified tests must use test.unit, test.server or test.browser.');

      if (classification(node) && !immediateUse(node))
        report(node, 'Do not alias test modifiers; keep their classification visible.');
    }

    function checkGlobalTestMember(node: any): void {
      if (
        rawNames.has(memberName(node)!) &&
        ['globalThis', 'window', 'global'].includes(node.object.name) &&
        !binding(context, node.object)?.defs.length
      )
        report(node);
    }

    function checkRuntimeTestMember(node: any): void {
      if (memberName(node) === 'test' && testContext(node.object))
        report(
          node,
          'Declare classified tests during suite collection instead of registering runtime subtests.'
        );
    }

    function checkForbiddenMember(node: any): void {
      if (forbidden.has(memberName(node)!) && classification(node.object))
        report(node, 'Classified tests cannot be focused, skipped, pending or inverted.');
    }

    function checkDynamicScenarioMember(node: any): void {
      const name = memberName(node);
      const source = dynamicImportSource(context, root(node.object));

      if (
        ['stable', 'regression', 'migration', 'characterization'].includes(name ?? '') &&
        source !== undefined &&
        !scenarioModules.has(source)
      )
        report(
          node,
          'Register scenario tests through their exact named starter import; namespaces and aliases are forbidden.'
        );
    }

    function registrationCall(node: any): void {
      const owner = root(node.callee);
      const value = importedValue(context, node.callee);
      const name = value?.name ?? '';

      reportFlatRegistration(node, name);
      reportFlatHook(node, name);
      reportHiddenRegistration(node, owner, name);

      ordinaryRegistrationCall(node, owner);
    }

    function reportFlatRegistration(node: any, name: string): void {
      if (/^test\.(?:stable|regression|migration|characterization)(?:\.|$)/.test(name))
        report(node, 'Classified tests must use test.unit, test.server or test.browser.');
    }

    function reportFlatHook(node: any, name: string): void {
      if (
        /^test\.(?:describe|suite|beforeEach|afterEach|beforeAll|afterAll|each|for|concurrent|skip|only)(?:\.|$)/.test(
          name
        )
      )
        report(node, 'Test hooks and modifiers must use an explicit environment namespace.');
    }

    function reportHiddenRegistration(node: any, owner: any, name: string): void {
      if (
        !/^test\.(?:unit|server|browser)\.(?:stable|regression|migration|characterization)(?:\.|$)/.test(
          name
        )
      )
        return;

      if (!approved(owner, 'test'))
        report(node, 'Import the test namespace by its canonical name from @study/testing.');

      if (nestedRegistration(node) && !testApiOwnerPath(filename))
        report(node, 'Register tests directly; do not hide them in local wrapper functions.');
    }

    return {
      ...edges,
      CallExpression(node: any) {
        edges.CallExpression(node);
        factoryCall(node);
        registrationCall(node);

        if (storedScenarioExtension(context, filename, node))
          report(
            node,
            'Register tests directly with the canonical starter; do not store named scenario wrappers.'
          );

        if (
          !filename.includes('/packages/testing/') &&
          localScenarioExtension(context, node.callee)
        )
          report(
            node,
            'Register tests directly with the canonical starter; do not call a stored scenario wrapper.'
          );

        if (classification(node.callee) && forbiddenOptions(node.arguments[1]))
          report(node, 'Classified tests cannot be focused, skipped, pending or inverted.');
      },
      Identifier(node: any) {
        checkTestIdentifier(node);
      },
      MemberExpression(node: any) {
        checkClassifiedMember(node);
        checkGlobalTestMember(node);
        checkRuntimeTestMember(node);
        checkForbiddenMember(node);
        checkDynamicScenarioMember(node);
      },
      VariableDeclarator(node: any) {
        const initializer = node.init?.type === 'AwaitExpression' ? node.init.argument : node.init;

        if (
          node.id.type === 'ObjectPattern' &&
          initializer?.type === 'ImportExpression' &&
          node.id.properties.some((part: any) => part.key?.name === 'test')
        )
          report(
            node,
            'Register scenario tests through their exact named starter import; namespaces and aliases are forbidden.'
          );

        if (
          node.id.type === 'ObjectPattern' &&
          testContext(node.init) &&
          node.id.properties.some((part: any) => part.key?.name === 'test')
        )
          report(
            node,
            'Declare classified tests during suite collection instead of extracting runtime test methods.'
          );
      }
    };
  }
});
