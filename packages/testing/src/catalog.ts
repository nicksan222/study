export const regressions = {
  evidence_integrity:
    'Prevent Unicode anchor, evidence conflict, retention and support invalidation regressions'
} as const;

export const migrations = {
  document_domains_cutover:
    'Preserve exact authored documents, source captures and retained identities through the domain cutover',
  source_upgrade: 'Upgrade stored source snapshots while preserving retained documents',
  material_metadata_migration:
    'Migrate material metadata while preserving rows and database invariants',
  ask_migration: 'Preserve Ask retirement and publication guards through schema migration'
} as const;
