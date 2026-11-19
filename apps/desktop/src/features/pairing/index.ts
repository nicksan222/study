import type { ClientModule } from '@study/client/app';
import { PhoneIcon } from '@study/icons';

import { MobileBackground } from './background';
import { DesktopMobileSettings } from './settings';

export const pairing: ClientModule = {
  id: 'phone-pairing',
  Background: MobileBackground,
  settings: {
    id: 'module:phone-pairing',
    label: 'MobileStudy',
    group: 'SettingsGroupDevices',
    Icon: PhoneIcon,
    keywords: ['MobilePair', 'MobileScanTitle'],
    Content: DesktopMobileSettings
  }
};
