/** Router context carries no server-state cache; loaders use canonical scoped reads. */
export type AppRouterContext = Record<string, never>;
