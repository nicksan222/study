/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds a bounded evidence catalog from captured document blocks for agent search   │
 * │ and citation validation. Search exposes numbered snippets, and citations are limited to  │
 * │ snippets actually returned.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Admits complete selected text within explicit corpus and passage bounds.               │
 * │ - Ranks bounded snippets and only resolves citations for returned markers.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Agent callers provide document references and blocks; the catalog bounds exposed text    │
 * │ and does not load or persist source documents.                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';

import { splitTextRanges } from '#server/platform/ai/document-processing/planner';

// Corpus limits use UTF-16 code units; serialized search replies use UTF-8 bytes.
const maxCorpusChars = 1_000_000;

const maxPassages = 10_000;

const maxQuoteChars = 1000;

const maxSearchBytes = 32_000;

const encoder = new TextEncoder();

interface CapturedDocument<Reference> {
  key: string;
  reference: Reference;
  name: string;
  quoteLimit?: number;
  blocks: readonly { readonly text: string; readonly blockOrdinal?: number }[];
}

interface EvidencePassage<Reference> {
  readonly marker: number;
  readonly reference: Reference;
  readonly blockOrdinal: number;
  readonly name: string;
  readonly quote: string;
}

function validatePassage<Reference>(entry: EvidencePassage<Reference>) {
  if (!Number.isInteger(entry.marker) || entry.marker < 1 || entry.marker > 0xffff_ffff)
    throw new StudyError('invalid_input', 'Evidence marker must be a positive uint32');

  if (!Number.isSafeInteger(entry.blockOrdinal) || entry.blockOrdinal < 0)
    throw new StudyError('invalid_input', 'Evidence ordinal must be a nonnegative integer');

  if (entry.quote.length > maxQuoteChars || entry.name.length > 200)
    throw new StudyError('invalid_input', 'Evidence passage exceeds its text bounds');
}

function createEvidenceIndex<Reference>() {
  const entries = new Map<number, EvidencePassage<Reference>>();
  const exposed = new Set<number>();
  let corpusChars = 0;

  function addPassages(passages: readonly EvidencePassage<Reference>[], initiallyExposed = false) {
    if (entries.size + passages.length > maxPassages)
      throw new StudyError('not_enough', 'Selected evidence exceeds the passage count bound');

    const pending = new Set<number>();
    let addedChars = 0;

    for (const entry of passages) {
      validatePassage(entry);

      if (entries.has(entry.marker) || pending.has(entry.marker))
        throw new StudyError('invalid_input', 'Evidence markers must be unique');

      pending.add(entry.marker);
      addedChars += entry.quote.length;
    }

    if (corpusChars + addedChars > maxCorpusChars)
      throw new StudyError('not_enough', 'Selected evidence exceeds the corpus character bound');

    for (const entry of passages) {
      entries.set(entry.marker, { ...entry });

      if (initiallyExposed) exposed.add(entry.marker);
    }

    corpusChars += addedChars;
  }

  function search(query: string) {
    const terms = query.slice(0, 1000).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 32);

    if (!terms.length) return [];

    const ranked = [...entries.values()].map((entry) => {
      const quote = entry.quote.toLowerCase();

      return { entry, score: terms.filter((term) => quote.includes(term)).length };
    });

    ranked.sort((a, b) => b.score - a.score || a.entry.marker - b.entry.marker);

    const hits: { id: string; name: string; text: string }[] = [];

    for (const { entry, score } of ranked) {
      if (score === 0 || hits.length === 10) break;

      const hit = {
        id: String(entry.marker),
        name: entry.name,
        text: `[${entry.marker}] ${entry.quote}`
      };

      if (encoder.encode(JSON.stringify([...hits, hit])).byteLength > maxSearchBytes) break;

      hits.push(hit);
      exposed.add(entry.marker);
    }

    return hits;
  }

  function citations(text: string) {
    const markers = new Set(Array.from(text.matchAll(/\[(\d+)\]/g), (match) => Number(match[1])));

    return [...markers].map((marker) => {
      const entry = entries.get(marker);

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

  return { addPassages, search, citations };
}

/** Explicit exposure authorizes passages already supplied to an earlier processing step. */
export function createPassageEvidenceCatalog<Reference>(
  entries: readonly EvidencePassage<Reference>[],
  options?: { initiallyExposed?: boolean }
) {
  const index = createEvidenceIndex<Reference>();

  index.addPassages(entries, options?.initiallyExposed);

  return { search: index.search, citations: index.citations };
}

function documentPassages<Reference>(document: CapturedDocument<Reference>, existingCount: number) {
  const requestedQuoteChars = document.quoteLimit ?? maxQuoteChars;

  if (!Number.isSafeInteger(requestedQuoteChars) || requestedQuoteChars < 1)
    throw new StudyError('invalid_input', 'Evidence quote bound must be a positive integer');

  const quoteChars = Math.min(requestedQuoteChars, maxQuoteChars);
  const pending: EvidencePassage<Reference>[] = [];

  for (const [blockOrdinal, block] of document.blocks.entries()) {
    for (const range of splitTextRanges(block.text, quoteChars)) {
      const quote = block.text.slice(range.start, range.end);

      if (!quote.trim()) continue;

      if (existingCount + pending.length >= maxPassages)
        throw new StudyError('not_enough', 'Selected evidence exceeds the passage count bound');

      pending.push({
        marker: existingCount + pending.length + 1,
        reference: document.reference,
        blockOrdinal: block.blockOrdinal ?? blockOrdinal,
        name: document.name.slice(0, 200),
        quote
      });
    }
  }

  return pending;
}

export function createEvidenceCatalog<Reference>(
  documents: readonly CapturedDocument<Reference>[]
) {
  const index = createEvidenceIndex<Reference>();
  const seen = new Set<string>();
  let corpusChars = 0;
  let passageCount = 0;

  function addDocument(document: CapturedDocument<Reference>) {
    if (seen.has(document.key)) return;

    const addedChars = document.blocks.reduce((total, block) => total + block.text.length, 0);

    if (corpusChars + addedChars > maxCorpusChars)
      throw new StudyError('not_enough', 'Selected evidence exceeds the corpus character bound');

    const pending = documentPassages(document, passageCount);

    // Commit admission only after every block passes, preserving prior marker identities.
    index.addPassages(pending);
    seen.add(document.key);
    corpusChars += addedChars;
    passageCount += pending.length;
  }

  for (const document of documents) addDocument(document);

  return { addDocument, search: index.search, citations: index.citations };
}
