import '@fontsource-variable/inter';
import '@study/ui/styles.css';
import '@study/client/styles.css';
import { mountClient } from '@study/client/app';

import { pairing } from './features/pairing';

mountClient([pairing]);
