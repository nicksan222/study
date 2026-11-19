import { test } from '@study/testing';

import { invitationUrl, parseInvitation } from './protocol';

const invitation = {
  room: crypto.randomUUID(),
  secret: crypto.randomUUID(),
  desktop: 'desktop012345678901234',
  expiresAt: 1795000000000
};

test.unit.stable('mobile invitations carry credentials only in the URL fragment', ({ expect }) => {
  const base = 'https://example.com/study/mobile/?lang=it';
  const url = new URL(invitationUrl(base, invitation));

  expect(url.origin + url.pathname + url.search).toBe(base);
  expect(parseInvitation(url.href)).toEqual(invitation);
});

test.unit.stable('mobile invitations reject malformed and missing pairing data', ({ expect }) => {
  const base = 'https://example.com/study/mobile/';

  for (const url of [
    base,
    `${base}#pair=%`,
    invitationUrl(base, { ...invitation, secret: 'invalid' }),
    invitationUrl(base, { ...invitation, desktop: 'invalid' }),
    invitationUrl(base, { ...invitation, expiresAt: 0 })
  ]) {
    expect(() => parseInvitation(url)).toThrow();
  }
});
