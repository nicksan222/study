import { MAX_BACKUP_BYTES } from '@study/contracts';
import { test } from '@study/testing';
import { Clock, Effect } from 'effect';
import { TestClock } from 'effect/testing';

import { sendBackupRequest } from './backup-storage-http.ts';
import { signS3Put } from './s3-backup.ts';
import { storageStrategies } from './storage-backup.ts';

const name = 'Study-folder-1.studybackup';

const bytes = new TextEncoder().encode('study backup');

test.server.stable(
  'a large upload can finish after two minutes on a slow link',
  async ({ expect }) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const dispatched = Promise.withResolvers<void>();
        const response = Promise.withResolvers<Response>();
        const send = sendBackupRequest(async () => {
          dispatched.resolve();

          return response.promise;
        }, clock);
        const upload = send(new URL('https://objects.example.test/backup'), {
          method: 'PUT',
          body: new Uint8Array(MAX_BACKUP_BYTES)
        });
        const result = upload.then(
          () => undefined,
          (error: unknown) => error
        );

        yield* Effect.promise(() => dispatched.promise);

        yield* TestClock.adjust('10 minutes');
        response.resolve(new Response(null, { status: 201 }));
        expect(yield* Effect.promise(() => result)).toBeUndefined();
      }).pipe(Effect.provide(TestClock.layer()))
    );
  }
);

test.server.stable(
  'S3 uses a bounded PUT signed for the configured bucket, region and prefix',
  async ({ expect }) => {
    const strategy = storageStrategies(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      expect(request.method).toBe('PUT');
      expect(request.redirect).toBe('error');
      expect(url.origin).toBe('https://objects.example.test');
      expect(url.pathname).toBe(
        '/proxy/study-backups/Study%20files/daily/Study-folder-1.studybackup'
      );
      expect(request.headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=study-key\/\d{8}\/auto\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[a-f0-9]{64}$/
      );
      expect(url.search).toBe('');
      expect(request.headers.has('x-amz-security-token')).toBe(false);
      expect(await request.text()).toBe('study backup');

      return new Response(null, { status: 200 });
    }).s3;

    await strategy.upload(
      {
        kind: 's3',
        endpoint: 'https://objects.example.test/proxy/',
        bucket: 'study-backups',
        region: 'auto',
        prefix: 'Study files/daily/',
        accessKeyId: 'study-key',
        secretAccessKey: 'private-key'
      },
      name,
      bytes,
      new AbortController().signal
    );
  }
);

test.server.stable(
  'WebDAV stages raw backup bytes then publishes the reserved slot with MOVE',
  async ({ expect }) => {
    const finalUrl =
      'https://cloud.example.test/dav/files/learner/Study%20files/Study-folder-1.studybackup';
    const methods: string[] = [];
    const strategy = storageStrategies(async (input, init) => {
      const request = new Request(input, init);

      methods.push(request.method);
      expect(request.url).toBe(finalUrl + '.upload');
      expect(request.headers.get('authorization')).toBe('Basic bGVhcm5lcjpzZWNyZXQ=');

      if (request.method === 'PUT') expect(await request.text()).toBe('study backup');
      else {
        expect(request.headers.get('destination')).toBe(finalUrl);
        expect(request.headers.get('overwrite')).toBe('T');
      }

      return new Response(null, { status: 204 });
    }).webdav;

    await strategy.upload(
      {
        kind: 'webdav',
        url: 'https://cloud.example.test/dav/files/learner/Study%20files',
        username: 'learner',
        password: 'secret'
      },
      name,
      bytes,
      new AbortController().signal
    );
    expect(methods).toEqual(['PUT', 'MOVE']);
  }
);

test.server.stable(
  'Azure writes a block blob without altering the SAS signature',
  async ({ expect }) => {
    const strategy = storageStrategies(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      expect(url.pathname).toBe('/my-container/Study%20files/Study-folder-1.studybackup');
      expect(url.search).toBe('?sv=2021-12-02&sp=w&sr=c&sig=test%2Bvalue%3D');
      expect(request.headers.get('x-ms-blob-type')).toBe('BlockBlob');
      expect(request.headers.get('authorization')).toBeNull();
      expect(await request.text()).toBe('study backup');

      return new Response(null, { status: 201 });
    })['azure-blob'];

    await strategy.upload(
      {
        kind: 'azure-blob',
        url: 'https://azure.example.test/my-container/',
        sas: '?sv=2021-12-02&sp=w&sr=c&sig=test%2Bvalue%3D',
        prefix: 'Study files'
      },
      name,
      bytes,
      new AbortController().signal
    );
  }
);

test.server.stable(
  'insecure destinations fail before a credential or archive can leave Study',
  async ({ expect }) => {
    const strategy = storageStrategies(() => {
      throw new Error('unexpected request');
    }).webdav;

    await expect(
      strategy.upload(
        {
          kind: 'webdav',
          url: 'http://cloud.example.test/dav',
          username: 'learner',
          password: 'secret'
        },
        name,
        bytes,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  }
);

test.server.stable(
  'provider errors never preserve SAS tokens or transport errors in the error chain',
  async ({ expect }) => {
    const strategy = storageStrategies((input) => {
      throw new Error(String(input));
    })['azure-blob'];
    const error = await strategy
      .upload(
        {
          kind: 'azure-blob',
          url: 'https://azure.example.test/my-container/',
          sas: 'sv=2021-12-02&sp=w&sr=c&sig=privileged-token'
        },
        name,
        bytes,
        new AbortController().signal
      )
      .catch((error: unknown) => error);

    expect(error).toMatchObject({ kind: 'transient', message: 'Backup upload request failed' });
    expect(error).toHaveProperty('cause', undefined);
  }
);

// Public example credentials and expected signature from AWS's single-chunk PUT example.
test.server.stable('S3 signing matches the AWS SigV4 PUT Object example', ({ expect }) => {
  const headers = new Headers({
    date: 'Fri, 24 May 2013 00:00:00 GMT',
    'x-amz-storage-class': 'REDUCED_REDUNDANCY'
  });

  signS3Put(
    new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
    headers,
    new TextEncoder().encode('Welcome to Amazon S3.'),
    {
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    },
    new Date('2013-05-24T00:00:00.000Z')
  );

  expect(headers.get('authorization')).toMatch(
    /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/
  );
});

test.server.stable(
  'malformed remote object settings fail during validation before saving',
  ({ expect }) => {
    expect(() =>
      storageStrategies().s3.validate({
        kind: 's3',
        bucket: 'study-backups',
        region: 'us-east-1',
        accessKeyId: 'study-key',
        secretAccessKey: 'private-key',
        prefix: 'other/../outside'
      })
    ).toThrow('Backup prefixes must contain named path segments');

    expect(() =>
      storageStrategies()['azure-blob'].validate({
        kind: 'azure-blob',
        url: 'https://azure.example.test/my-container',
        sas: 'sv=2021-12-02&sp=r&sr=c&sig=token'
      })
    ).toThrow('Use an Azure container URL and its SAS token');
  }
);

test.server.stable(
  'a provider denial leaves a typed credential failure without reflecting request data',
  async ({ expect }) => {
    const strategy = storageStrategies(
      async () => new Response('provider details with a secret', { status: 403 })
    ).webdav;

    await expect(
      strategy.upload(
        {
          kind: 'webdav',
          url: 'https://cloud.example.test/dav',
          username: 'learner',
          password: 'secret'
        },
        name,
        bytes,
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      kind: 'auth',
      message: 'Backup storage returned HTTP 403',
      cause: undefined
    });
  }
);
