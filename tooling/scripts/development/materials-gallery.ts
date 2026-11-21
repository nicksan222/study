const workflows = {
  'material-formats-render-on-desktop-and-phone': 'Formati su desktop e telefono',
  'switch-among-fourteen-material-formats-in-one-subject': 'Elenco dei materiali',
  'materials-show-live-extraction-and-preserve-retained-revisions':
    'Stati e recupero dell’estrazione',
  'materials-show-provider-wait-and-cancelled-extraction': 'Accesso richiesto e annullamento',
  'materials-show-the-real-image-extraction-phase': 'Lettura dell’immagine con il modello'
} as const;

const labels: Readonly<Record<string, string>> = {
  'mixed-subject': 'Desktop · documento selezionato',
  'mobile-material-list': 'Telefono · elenco dei materiali',
  queued: 'Estrazione in coda',
  extracting: 'Estrazione in corso',
  generating: 'Lettura con il modello',
  completed: 'Estrazione completata',
  unsupported: 'Formato non leggibile',
  failed: 'Estrazione non riuscita',
  'retained-extraction': 'Versione precedente conservata',
  recovered: 'Estrazione riuscita al nuovo tentativo',
  'provider-wait': 'In attesa dell’accesso',
  'provider-wait-italian': 'In attesa dell’accesso · Italiano',
  cancelled: 'Estrazione annullata · Inglese',
  'cancelled-italian': 'Estrazione annullata · Italiano'
};

const [input, output] = Bun.argv.slice(2);

if (!input || !output)
  throw new Error('Usage: bun materials-gallery.ts <shards-directory> <gallery-directory>');

const baselines = Bun.fileURLToPath(
  new URL('../../../apps/client/test/e2e/baselines/linux-x64-chromium/', import.meta.url)
);

function caption(name: string) {
  const stem = name.slice(0, -4);

  if (stem.endsWith('-desktop-dark')) return `.${stem.slice(0, -13)} · Desktop scuro`;

  if (stem.endsWith('-phone-light')) return `.${stem.slice(0, -12)} · Telefono chiaro`;

  return labels[stem] ?? stem.replaceAll('-', ' ');
}

const sections = await Promise.all(
  Object.entries(workflows).map(async ([workflow, title]) => {
    const pngs = new Bun.Glob('*.png');
    const expected = [...pngs.scanSync({ cwd: `${baselines}/${workflow}` })].toSorted();

    if (!expected.length) throw new Error(`No named baselines for workflow: ${workflow}`);

    const paths = new Map<string, string>();

    for (const path of new Bun.Glob(`*/${workflow}/*.png`).scanSync({ cwd: input })) {
      const name = path.slice(path.lastIndexOf('/') + 1);

      if (paths.has(name)) throw new Error(`Duplicate review screenshot: ${workflow}/${name}`);

      if (!expected.includes(name))
        throw new Error(`Unexpected review screenshot: ${workflow}/${name}`);

      paths.set(name, path);
    }

    const images = await Promise.all(
      expected.map(async (name) => {
        const path = paths.get(name);

        if (!path) throw new Error(`Missing review screenshot: ${workflow}/${name}`);

        const bytes = await Bun.file(`${input}/${path}`).bytes();
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        if (
          bytes.length < 33 ||
          header.getBigUint64(0) !== 0x89504e470d0a1a0an ||
          header.getUint32(12) !== 0x49484452
        )
          throw new Error(`Invalid PNG: ${workflow}/${name}`);

        const width = header.getUint32(16);
        const height = header.getUint32(20);

        if (!width || !height) throw new Error(`Invalid PNG dimensions: ${workflow}/${name}`);

        return { path: `images/${workflow}/${name}`, bytes, width, height, title: caption(name) };
      })
    );

    return { workflow, title, images };
  })
);

const images = sections.flatMap((section) => section.images);

await Promise.all(images.map(({ path, bytes }) => Bun.write(`${output}/${path}`, bytes)));
await Bun.write(
  `${output}/index.html`,
  `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Materiali in Study · Galleria CI</title>
<style>
  :root { color-scheme: light dark; font: 16px/1.5 system-ui; }
  body { margin: 2rem auto; max-width: 90rem; padding-inline: 1rem; }
  nav { display: flex; gap: .75rem 1.25rem; flex-wrap: wrap; }
  section { margin-block: 2.5rem; }
  ul { list-style: none; padding: 0; display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); }
  a:focus-visible { outline: 2px solid; outline-offset: 4px; }
  li a { display: grid; gap: .5rem; align-content: start; }
  img { display: block; width: 100%; height: 8rem; object-fit: contain; background: color-mix(in srgb, CanvasText 7%, Canvas); border-radius: .375rem; }
</style>
</head>
<body>
<h1>Materiali in Study</h1>
<p>${images.length} schermate del test browser. Apri una schermata per vederla alla risoluzione originale.</p>
<nav id="indice" aria-label="Indice della galleria">
${sections.map(({ workflow, title }) => `<a href="#${workflow}">${title}</a>`).join('\n')}
</nav>
<main>
${sections
  .map(
    ({ workflow, title, images }) => `<section id="${workflow}">
<h2>${title}</h2>
<ul>
${images.map(({ path, title, width, height }) => `<li><a href="${Bun.escapeHTML(path)}"><img src="${Bun.escapeHTML(path)}" alt="" loading="lazy" width="${width}" height="${height}"><span>${Bun.escapeHTML(title)}</span></a></li>`).join('\n')}
</ul>
<a href="#indice">Torna all’indice</a>
</section>`
  )
  .join('\n')}
</main>
</body>
</html>
`
);
