// The site's icons and link previews, drawn at build time from the same sources as the app:
// the logo masters in assets/logo, the app's fonts in study-ui, the hero's headline and a
// capture of a session, so none of them is a file to keep up to date by hand.
import satori from 'satori';
import sharp from 'sharp';
import full from '../../../assets/logo/study.svg?raw';
import interRegular from '../../../crates/study-ui/assets/fonts/Inter-Regular.ttf?inline';
import interSemiBold from '../../../crates/study-ui/assets/fonts/Inter-SemiBold.ttf?inline';
import { t, type Lang } from './i18n/strings';

export { default as small } from '../../../assets/logo/study-small.svg?raw';

/** A PNG for an endpoint to answer with. */
const png = (bytes: Uint8Array) => new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } });

/** The full mark as a PNG `size` pixels square, for home screens, which round the corners
 * themselves: the tile's color fills its own rounded corners. */
export async function mark(size: number): Promise<Response> {
  const tile = full.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)?.[1];
  if (!tile) throw new Error('the logo master no longer starts with its tile');
  return png(
    await sharp(Buffer.from(full), { density: 72 * (size / 64) })
      .resize(size, size)
      .flatten({ background: tile })
      .png()
      .toBuffer(),
  );
}

const captures = import.meta.glob<string>('./assets/shots/session-*-light.webp', {
  eager: true,
  query: '?inline',
  import: 'default',
});

/** The bytes behind a `data:` URL that Vite inlined. */
const bytes = (url: string) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** The 1200×630 card a link to the site shows in `lang`: the mark, the headline and a session. */
export async function preview(lang: Lang): Promise<Response> {
  const capture = captures[`./assets/shots/session-${lang}-light.webp`];
  if (!capture) throw new Error(`no session capture in ${lang}: make it with \`just docs-media session\``);
  const session = await sharp(bytes(capture)).resize({ width: 1080 }).png().toBuffer();
  const words = t(lang).hero.title.split(' ');
  const last = words.pop();

  const node = (type: string, style: object, children?: unknown, extra: object = {}) => ({
    type,
    props: { style, children, ...extra },
  });
  const tree = node('div', { display: 'flex', width: 1200, height: 630, background: '#ffffff', position: 'relative', fontFamily: 'Inter', color: '#111111' }, [
    node('img', { position: 'absolute', left: 660, top: 70, width: 1080, borderRadius: 12, border: '1px solid #e4e4e4' }, undefined, {
      src: `data:image/png;base64,${session.toString('base64')}`,
    }),
    node('div', { display: 'flex', flexDirection: 'column', position: 'absolute', left: 80, top: 96, width: 520 }, [
      node('div', { display: 'flex', alignItems: 'center', gap: 20 }, [
        node('img', { width: 64, height: 64 }, undefined, { src: `data:image/svg+xml;base64,${Buffer.from(full).toString('base64')}` }),
        node('div', { fontSize: 40, fontWeight: 600 }, 'Study'),
      ]),
      node('div', { display: 'flex', flexWrap: 'wrap', marginTop: 44, fontSize: 64, fontWeight: 600, lineHeight: 1.08, letterSpacing: -1.5 }, [
        ...words.map((word) => node('span', { marginRight: 16 }, word)),
        node('span', { background: '#fff0a1', padding: '0 4px' }, last),
      ]),
    ]),
  ]);
  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: bytes(interRegular), weight: 400 },
      { name: 'Inter', data: bytes(interSemiBold), weight: 600 },
    ],
  });
  return png(await sharp(Buffer.from(svg)).png().toBuffer());
}
