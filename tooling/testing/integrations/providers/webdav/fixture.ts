/** Starts an authenticated, HTTPS rclone WebDAV endpoint with disposable storage. */

import { CloudContainer, cloudTls, httpsReady, startCloudContainer } from '../cloud-container.ts';

const image =
  'rclone/rclone:1.74.0@sha256:d2e0e88359d0b2e67cfcd2c43d5405185eb8adfc207079df27c42da82c5207bc';

export async function startWebDav() {
  const tls = cloudTls();
  const port = 8080;
  const username = 'study';
  const password = crypto.randomUUID();
  const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const storage = await startCloudContainer(
    'webdav',
    new CloudContainer(image, port)
      .withCommand([
        'serve',
        'webdav',
        '/data',
        '--addr',
        `:${port}`,
        '--user',
        username,
        '--pass',
        password,
        '--cert',
        '/tmp/study-tls/rustfs_cert.pem',
        '--key',
        '/tmp/study-tls/rustfs_key.pem'
      ])
      .withUser('0')
      .withBindMounts([tls])
      .withWaitStrategy(httpsReady(port, '/', 401))
  );
  const configuration = { kind: 'webdav', url: storage.endpoint, username, password } as const;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(storage.endpoint + path, { ...init, headers: { authorization, ...init.headers } });

  return {
    configuration,
    async keys() {
      const response = await request('/', { method: 'PROPFIND', headers: { depth: '1' } });

      if (response.status !== 207) throw new Error('WebDAV listing failed');

      return Array.from((await response.text()).matchAll(/<[^<>]*?href>\/([^<]+)<\//g), ([, key]) =>
        decodeURIComponent(key!)
      );
    },
    async read(key: string) {
      const response = await request(`/${encodeURIComponent(key)}`);

      if (!response.ok) throw new Error('WebDAV download failed');

      return new Uint8Array(await response.arrayBuffer());
    },
    [Symbol.asyncDispose]: () => storage[Symbol.asyncDispose]()
  };
}
