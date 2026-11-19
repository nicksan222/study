import { Schema } from 'effect';

export const invitationSchema = Schema.Struct({
  room: Schema.String.check(Schema.isUUID()),
  secret: Schema.String.check(Schema.isUUID()),
  desktop: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9]{22}$/)),
  expiresAt: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0)))
});

export const desktopLinkSchema = Schema.Struct({
  ...invitationSchema.fields,
  phone: invitationSchema.fields.desktop
});

export type Invitation = typeof invitationSchema.Type;

export type DesktopLink = typeof desktopLinkSchema.Type;

export const isSocketId = Schema.is(Schema.String.check(Schema.isUUID()));

export type OpenPhoneRpc = (
  signal: AbortSignal
) => Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }>;

export const frameSize = 64 * 1024;

export function invitationUrl(base: string, invitation: Invitation) {
  const url = new URL(base);

  url.hash = 'pair=' + encodeURIComponent(JSON.stringify(invitation));

  return url.href;
}

export function parseInvitation(url: string): Invitation {
  const hash = new URL(url).hash;
  const payload = hash.startsWith('#pair=') ? decodeURIComponent(hash.slice(6)) : 'null';
  const invitation = Schema.decodeUnknownSync(invitationSchema)(JSON.parse(payload));

  return {
    room: invitation.room,
    secret: invitation.secret,
    desktop: invitation.desktop,
    expiresAt: invitation.expiresAt
  };
}

export function fromStorage<S extends Schema.ConstraintDecoder<unknown>>(
  key: string,
  schema: S
): S['Type'] | undefined {
  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return undefined;
  }
}
