import type { IconComponent } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';
import { createContext } from 'react';
import type { ComponentType } from 'react';

export type ModuleSettingsId = `module:${string}`;

export type ModuleSettings = {
  id: ModuleSettingsId;
  group: StaticMessageKey;
  label: StaticMessageKey;
  Icon: IconComponent;
  keywords: readonly StaticMessageKey[];
  Content: ComponentType;
};

export type ClientModule = {
  id: string;
  Background?: ComponentType;
  settings?: ModuleSettings;
};

export const ClientModules = createContext<readonly ClientModule[]>([]);
