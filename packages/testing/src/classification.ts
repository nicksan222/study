import { regressions, migrations } from './catalog.ts';

type RegressionId = keyof typeof regressions;

type MigrationId = keyof typeof migrations;

export type Regression = { regression: RegressionId };

type Temporary = { retention: 'temporary'; removeWhen: string };

type Permanent = { retention: 'permanent'; removeWhen?: never };

export type Migration = { migration: MigrationId } & (Temporary | Permanent);

export type Characterization = { migration: MigrationId } & Temporary;

type Kind = 'regression' | 'migration' | 'characterization';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRetention(kind: Kind, metadata: Record<string, unknown>): boolean {
  if (metadata.retention === 'permanent')
    return kind === 'migration' && Object.keys(metadata).length === 2;

  return (
    metadata.retention === 'temporary' &&
    Object.keys(metadata).length === 3 &&
    typeof metadata.removeWhen === 'string' &&
    metadata.removeWhen.trim().length > 0
  );
}

/** One validation boundary for typed adapters, JavaScript callers and lint metadata. */
export function classificationLabel(kind: Kind, metadata: unknown): string {
  if (!record(metadata)) throw new TypeError('Test classification requires metadata');

  const identifier = metadata[kind === 'regression' ? 'regression' : 'migration'];
  const catalog = kind === 'regression' ? regressions : migrations;

  if (typeof identifier !== 'string' || !Object.hasOwn(catalog, identifier))
    throw new TypeError('Test classification requires a known catalog identifier');

  const valid =
    kind === 'regression' ? Object.keys(metadata).length === 1 : validRetention(kind, metadata);

  if (!valid)
    throw new TypeError(
      'Test classification requires valid retention and temporary removal conditions'
    );

  return kind === 'regression'
    ? `${kind}:${identifier}`
    : `${kind}:${identifier}:${metadata.retention}`;
}

/** Enforce executable coverage even when JavaScript or indirect options bypass types. */
export function assertTestDefinition(name: unknown, options: unknown): void {
  if (typeof name !== 'string' || !name.trim())
    throw new TypeError('Classified tests require a nonempty name');

  if (
    record(options) &&
    ['only', 'skip', 'todo', 'fails', 'expectFailure'].some((key) => key in options)
  )
    throw new TypeError('Classified tests cannot be focused, skipped, pending or inverted');
}
