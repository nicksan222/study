import sharp from 'sharp';

const output = new URL('./dist/', import.meta.url);

const mark = await Bun.file(
  new URL('../../packages/ui/assets/logo/study.svg', import.meta.url)
).text();

const tile = mark.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)?.[1];

if (!tile) throw new Error('The Study logo master needs a tile color');

const icons = await Promise.all(
  [192, 512].map(async (size) => {
    const file = `icon-${size}.png`;
    const png = await sharp(Buffer.from(mark), { density: 72 * (size / 64) })
      .resize(size, size)
      .flatten({ background: tile })
      .png()
      .toBuffer();

    await Bun.write(new URL(file, output), png);

    return { src: './' + file, sizes: `${size}x${size}`, type: 'image/png' };
  })
);

await Bun.write(
  new URL('manifest.webmanifest', output),
  JSON.stringify({
    name: 'Study',
    short_name: 'Study',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    icons
  })
);
