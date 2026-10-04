// The landing's last call to download: the call, the other platforms in a line, and the notes.
import type { Os, Shape } from '../strings';

export const en = {
  get: {
    download: 'Download',
    downloadFor: {
      mac: 'Download for macOS',
      windows: 'Download for Windows',
      linux: 'Download for Linux',
      'linux-arm': 'Download for Linux',
    } satisfies Record<Os, string>,
    title: 'Study is free.',
    key: 'free',
    body: 'Open source, and every update is signed.',
    note: 'updates wait until you ask for them',
    also: 'Also for',
    every: 'For',
    rows: {
      mac: { name: 'macOS on Apple Silicon', label: 'Download for macOS on Apple Silicon' },
      windows: { name: 'Windows', label: 'Download for Windows, x86-64' },
      linux: { name: 'Linux x86-64', label: 'Download the Linux x86-64 AppImage' },
      'linux-arm': { name: 'Linux ARM64', label: 'Download the Linux ARM64 AppImage' },
    } satisfies Record<Os, { name: string; label: string }>,
    linuxNote: 'Linux needs Ubuntu 24.04, Debian 13 or newer.',
    optional: 'Optional: yt-dlp for YouTube videos, and FFmpeg for rare recording formats.',
    early: 'Study is in early development. Expect rough edges, and',
    tellUs: 'tell us about them',
    install: 'Installing Study',
    all: 'All releases',
  },
} as const;

export const it: Shape<typeof en> = {
  get: {
    download: 'Scarica',
    downloadFor: {
      mac: 'Scarica per macOS',
      windows: 'Scarica per Windows',
      linux: 'Scarica per Linux',
      'linux-arm': 'Scarica per Linux',
    },
    title: 'Study è gratis.',
    key: 'gratis',
    body: 'Open source, e ogni aggiornamento è firmato.',
    note: 'gli aggiornamenti arrivano solo quando li chiedi',
    also: 'Anche per',
    every: 'Per',
    rows: {
      mac: { name: 'macOS su Apple Silicon', label: 'Scarica per macOS su Apple Silicon' },
      windows: { name: 'Windows', label: 'Scarica per Windows, x86-64' },
      linux: { name: 'Linux x86-64', label: 'Scarica l’AppImage Linux x86-64' },
      'linux-arm': { name: 'Linux ARM64', label: 'Scarica l’AppImage Linux ARM64' },
    },
    linuxNote: 'Su Linux serve Ubuntu 24.04, Debian 13 o successivi.',
    optional: 'Facoltativi: yt-dlp per i video di YouTube e FFmpeg per i formati di registrazione rari.',
    early: 'Study è nelle prime fasi di sviluppo. Aspettati qualche imperfezione, e',
    tellUs: 'segnalacela',
    install: 'Installare Study',
    all: 'Tutte le versioni',
  },
};
