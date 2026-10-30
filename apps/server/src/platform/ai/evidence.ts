import { StudyError } from '@study/contracts/errors';

interface CapturedDocument<Reference> {
  key: string;
  reference: Reference;
  name: string;
  blocks: readonly { readonly text: string }[];
}

export function createEvidenceCatalog<Reference>(
  documents: readonly CapturedDocument<Reference>[]
) {
  const entries: Array<{
    marker: number;
    reference: Reference;
    blockOrdinal: number;
    name: string;
    quote: string;
  }> = [];
  const seen = new Set<string>();
  let remaining = 100_000;

  function addDocument(document: CapturedDocument<Reference>) {
    const key = document.key;

    if (seen.has(key)) return;

    seen.add(key);

    for (const [blockOrdinal, block] of document.blocks.entries()) {
      if (remaining <= 0 || entries.length >= 200) break;

      const quote = block.text.slice(0, Math.min(1000, remaining));

      if (!quote.trim()) continue;

      remaining -= quote.length;
      entries.push({
        marker: entries.length + 1,
        reference: document.reference,
        blockOrdinal,
        name: document.name.slice(0, 200),
        quote
      });
    }
  }

  for (const document of documents) addDocument(document);

  const exposed = new Set<number>();

  return {
    addDocument,
    search(query: string) {
      const terms = query.slice(0, 1000).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 32);
      const ranked = entries.map((entry) => ({
        entry,
        score: terms.filter((term) => entry.quote.toLowerCase().includes(term)).length
      }));

      ranked.sort((a, b) => b.score - a.score || a.entry.marker - b.entry.marker);

      return ranked
        .filter((item) => item.score > 0)
        .slice(0, 10)
        .map(({ entry }) => {
          exposed.add(entry.marker);

          return {
            id: String(entry.marker),
            name: entry.name,
            text: `[${entry.marker}] ${entry.quote}`
          };
        });
    },
    citations(text: string) {
      const markers = new Set(Array.from(text.matchAll(/\[(\d+)\]/g), (match) => Number(match[1])));

      return [...markers].map((marker) => {
        const entry = entries[marker - 1];

        if (!entry || !exposed.has(marker))
          throw new StudyError('invalid_input', 'Output cites unavailable evidence');

        return {
          marker,
          reference: entry.reference,
          blockOrdinal: entry.blockOrdinal,
          quote: entry.quote
        };
      });
    }
  };
}
