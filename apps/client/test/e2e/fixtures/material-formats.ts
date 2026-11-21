const seedFiles = new URL('../../../../../tooling/scripts/seed/fixtures/files/', import.meta.url);

function material(name: string, mimeType: string, fixture = `mitosis/${name}`) {
  return { name, mimeType, path: new URL(fixture, seedFiles) };
}

export const materialFormats = {
  docx: material(
    'laboratory.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ),
  pptx: material(
    'phases.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ),
  xlsx: material(
    'counts.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ),
  pdf: material('mitosis.pdf', 'application/pdf'),
  md: material('laboratory.md', 'text/markdown'),
  txt: material('cell-biology.txt', 'text/plain', 'cell-biology.txt'),
  png: material('metaphase.png', 'image/png'),
  json: material('observations.json', 'application/json'),
  csv: material('counts.csv', 'text/csv'),
  zip: material('laboratory.zip', 'application/zip'),
  bin: material('slide-counts.bin', 'application/octet-stream'),
  mp3: material('lecture.mp3', 'audio/mpeg'),
  wav: material('recording.wav', 'audio/wav', '../../../../testing/fixtures/voice/it_it_0139.wav'),
  mp4: material('division.mp4', 'video/mp4')
} as const;

// Hide only the variable timestamp during reference comparison, including at non-default CSS zoom.
export function hideExtractionTime(heading: string) {
  return `section[aria-label=${JSON.stringify(heading)}] time[datetime] { visibility: hidden !important; }`;
}
