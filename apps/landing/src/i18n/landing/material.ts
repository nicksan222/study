// The landing's material section: what Study reads, the Cell biology course's library (the
// sample's own files, each with its size as `media_size` writes it), the lecture that arrives,
// and its transcript.
import type { Shape } from '../strings';

export const en = {
  material: {
    title: 'Everything you study, in one place.',
    key: 'one place',
    body: 'Recordings, slides, PDFs, pictures, documents, web pages and YouTube videos, organized by course. Study reads each one, so a lecture becomes a transcript you can search and cite.',
    more: 'What Study can read',
    sessions: 'Sessions',
    library: 'Library',
    course: 'Cell biology',
    // The lecture that drops into the library, and what Study does with it.
    arriving: {
      name: 'lecture-mitosis.mp3',
      size: '44.1 MiB',
      working: 'Listening',
      done: 'Transcribed',
    },
    // The files already there, in the order the tile lists them, and their sizes; Material.astro
    // gives each its kind's glyph, in the same order.
    files: ['lecture-cell-cycle.mp3', 'slides-mitosis.pdf', 'Mitosis – Wikipedia'],
    sizes: ['38.6 MiB', '3.4 MiB', '212.7 KiB'],
    note: 'every line keeps its minute',
    transcript: 'Transcript',
  },
} as const;

export const it: Shape<typeof en> = {
  material: {
    title: 'Tutto ciò che studi, in un posto solo.',
    key: 'un posto solo',
    body: 'Registrazioni, slide, PDF, immagini, documenti, pagine web e video di YouTube, organizzati per corso. Study li legge uno per uno, così una lezione diventa una trascrizione che puoi cercare e citare.',
    more: 'Cosa sa leggere Study',
    sessions: 'Sessioni',
    library: 'Libreria',
    course: 'Biologia cellulare',
    arriving: {
      name: 'lecture-mitosis.mp3',
      size: '44,1 MiB',
      working: 'In ascolto',
      done: 'Trascritto',
    },
    files: ['lecture-cell-cycle.mp3', 'slides-mitosis.pdf', 'Mitosis – Wikipedia'],
    sizes: ['38,6 MiB', '3,4 MiB', '212,7 KiB'],
    note: 'ogni riga tiene il suo minuto',
    transcript: 'Trascrizione',
  },
};
