import type { FileRoutesByTo } from './routeTree.gen';

type PagePath = Exclude<keyof FileRoutesByTo, '/'>;

export type PageName = PagePath extends `/${infer Page}` ? Page : never;

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    page?: PageName;
  }
}
