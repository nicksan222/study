import r0 from './rules/application-transactions.ts';
import r2 from './rules/executed-query.ts';
import r5 from './rules/feature-persistence-boundary.ts';
import r1 from './rules/guarded-mutations.ts';
import r3 from './rules/sql-null-comparison.ts';
import r4 from './rules/workflow-persistence-boundary.ts';

export default {
  'application-transactions': r0,
  'guarded-mutations': r1,
  'executed-query': r2,
  'sql-null-comparison': r3,
  'workflow-persistence-boundary': r4,
  'feature-persistence-boundary': r5
};
