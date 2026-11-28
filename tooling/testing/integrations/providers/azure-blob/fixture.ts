/** Provisions an Azure container and a limited SAS against Microsoft's Azurite emulator. */

import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from '@azure/storage-blob';
import { createTestResources } from '@study/testing/resources';

import { CloudContainer, cloudTls, httpsReady, startCloudContainer } from '../cloud-container.ts';

const image =
  'mcr.microsoft.com/azure-storage/azurite:3.37.0@sha256:830430c1da1a2d537e08f3e6764dd1f5ae00cf0346bcaf625b968ec3f0971fd5';

export async function startAzureBlob() {
  const tls = cloudTls();
  const port = 10000;
  const account = 'studybackup';
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64');
  const containerName = 'study-backups';

  await using setup = createTestResources();
  const storage = await startCloudContainer(
    'azurite',
    new CloudContainer(image, port)
      .withCommand([
        'azurite-blob',
        '--blobHost',
        '0.0.0.0',
        '--location',
        '/data',
        '--cert',
        '/tmp/study-tls/rustfs_cert.pem',
        '--key',
        '/tmp/study-tls/rustfs_key.pem',
        '--skipApiVersionCheck'
      ])
      .withEnvironment({ AZURITE_ACCOUNTS: `${account}:${key}` })
      .withUser('0')
      .withBindMounts([tls])
      .withWaitStrategy(httpsReady(port, `/${account}?comp=list`, 403))
  );

  setup.defer(() => storage[Symbol.asyncDispose]());
  const credential = new StorageSharedKeyCredential(account, key);
  const service = new BlobServiceClient(`${storage.endpoint}/${account}`, credential);
  const client = service.getContainerClient(containerName);

  await client.create();
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      permissions: BlobSASPermissions.parse('cw'),
      protocol: SASProtocol.Https,
      expiresOn: new Date(Date.now() + 60 * 60 * 1000),
      version: '2021-12-02'
    },
    credential
  ).toString();
  const configuration = {
    kind: 'azure-blob',
    url: client.url,
    sas,
    prefix: 'Study backups'
  } as const;
  const resources = setup.move();

  return { configuration, client, [Symbol.asyncDispose]: resources.close };
}
