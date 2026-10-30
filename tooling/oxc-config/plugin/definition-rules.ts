import r1 from './rules/agent-definition.ts';
import r0 from './rules/contract-schema.ts';
import r3 from './rules/effect-lazy-boundary.ts';
import r4 from './rules/environment-boundary.ts';
import r2 from './rules/no-double-assertion.ts';

export default {
  'contract-schema': r0,
  'agent-definition': r1,
  'no-double-assertion': r2,
  'effect-lazy-boundary': r3,
  'environment-boundary': r4
};
