import { dirname, relative, resolve } from 'node:path';

export function webFile(filename: string): string | undefined {
  const path = filename.replaceAll('\\', '/');
  const marker = '/apps/web/src/';
  const index = path.lastIndexOf(marker);

  if (index < 0 || /\.(?:test|spec)\.[cm]?[jt]sx?$|\/(?:test|tests|__tests__)\//.test(path))
    return undefined;

  return path.slice(index + marker.length);
}

export function webTarget(filename: string, source: string): string | undefined {
  if (!source.startsWith('.') && !source.startsWith('/')) return undefined;

  const marker = '/apps/web/src/';
  const path = filename.replaceAll('\\', '/');
  const root = path.slice(0, path.lastIndexOf(marker) + marker.length);
  const target = relative(root, resolve(dirname(filename), source)).replaceAll('\\', '/');

  return target.startsWith('../') ? undefined : target.replace(/\.[cm]?[jt]sx?$/, '');
}

export function typeOnly(node: any): boolean {
  return (
    node.importKind === 'type' ||
    node.exportKind === 'type' ||
    (node.specifiers?.length > 0 &&
      node.specifiers.every(
        (item: any) => item.importKind === 'type' || item.exportKind === 'type'
      ))
  );
}
