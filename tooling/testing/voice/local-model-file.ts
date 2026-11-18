import type { Path } from 'effect';

/** Resolves the exact registered download URL against prepared or already installed files. */
export function localModelPaths(
  model: {
    readonly id: string;
    readonly assets: readonly { readonly url: string; readonly filename: string }[];
  },
  url: string,
  directory: string,
  path: Pick<Path.Path, 'join'>
) {
  const asset = model.assets.find((candidate) => candidate.url === url);

  if (!asset) return undefined;

  return [
    path.join(directory, model.id, 'ready', asset.filename),
    path.join(directory, asset.filename)
  ];
}
