import { after, beforeEach } from 'node:test';
import type { TestContext } from 'node:test';

import { cleanupTestFile, registerTest } from './automatic.ts';

beforeEach((t) => registerTest(t as TestContext));
after(cleanupTestFile);
