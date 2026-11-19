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

type SlotProps = {
  'shell.pageActions': { busy?: boolean };
  'capture.actions': { busy: boolean };
};

type ModuleSlots = {
  [Slot in keyof SlotProps]?: ComponentType<SlotProps[Slot]>;
};

export type ClientModule = {
  id: string;
  Boundary?: ComponentType<PropsWithChildren>;
  Background?: ComponentType;
  slots?: ModuleSlots;
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

/** Pages own slot placement. A module can contribute UI independently of its provider or background work. */
export function ClientSlot<Slot extends keyof SlotProps>({
  name,
  props
}: {
  name: Slot;
  props: SlotProps[Slot];
}) {
  return useContext(ClientModules).map(({ id, slots }) => {
    const Content: ComponentType<SlotProps[Slot]> | undefined = slots?.[name];

    return Content ? <Content key={id} {...props} /> : null;
  });
}
