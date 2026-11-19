import type { IconComponent } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';
import { createContext, useContext } from 'react';
import type { ComponentType, PropsWithChildren, ReactNode } from 'react';

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
  Boundary?: ComponentType<PropsWithChildren>;
  Background?: ComponentType;
  PageActions?: ComponentType<{ busy?: boolean }>;
  settings?: ModuleSettings;
};

const noModules: readonly ClientModule[] = [];

export const ClientModules = createContext(noModules);

/** Hosts explicitly register modules. Boundaries wrap page content in registration order. */
export function ClientExtensions({
  modules = noModules,
  children
}: {
  modules?: readonly ClientModule[];
  children: ReactNode;
}) {
  return (
    <ClientModules.Provider value={modules}>
      {modules.map(({ id, Background }) => (Background ? <Background key={id} /> : null))}
      {modules.reduceRight<ReactNode>(
        (content, { id, Boundary }) =>
          Boundary ? <Boundary key={id}>{content}</Boundary> : content,
        children
      )}
    </ClientModules.Provider>
  );
}

/** A page places platform actions without importing any host implementation. */
export function ClientPageActions({ busy }: { busy?: boolean }) {
  return useContext(ClientModules).map(({ id, PageActions }) =>
    PageActions ? <PageActions key={id} busy={busy} /> : null
  );
}
