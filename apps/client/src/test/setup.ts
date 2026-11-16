import '@study/testing/react/setup';
import { installTestApi } from '@study/testing/vitest';

import { test } from './scenarios.tsx';

installTestApi(test);
