export const regressions = {
  evidence_integrity:
    'Prevent Unicode anchor, evidence conflict, retention and support invalidation regressions'
} as const;

export const migrations = {
  source_upgrade: 'Upgrade stored source snapshots while preserving retained documents',
  material_metadata_migration:
    'Migrate material metadata while preserving rows and database invariants',
  ask_migration: 'Preserve Ask retirement and publication guards through schema migration'
} as const;
