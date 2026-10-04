---
title: Installare Study
description: Scarica Study per Linux, macOS o Windows e tienilo aggiornato.
section: start
order: 1
---

Study è un'app desktop. La installi una volta sul tuo computer, e progetti, file e appunti restano su quel computer. Ogni versione, nella pagina delle release del progetto su GitHub, ha un file da scaricare per ogni piattaforma.

## Scegli il file giusto

| Piattaforma | File |
|---|---|
| Linux su Intel o AMD | `study-linux-x86_64.AppImage` |
| Linux su ARM | `study-linux-aarch64.AppImage` |
| macOS su Apple Silicon | `study-macos-aarch64.dmg` |
| Windows | `study-windows-x86_64.exe` |

Su **Linux** l'AppImage è l'app intera. Rendila eseguibile, poi aprila:

```sh
chmod +x study-linux-x86_64.AppImage
./study-linux-x86_64.AppImage
```

Le versioni per Linux sono compilate su Ubuntu 24.04, quindi serve una distribuzione di quell'epoca o più recente.

Su **macOS** apri il `.dmg` e trascina Study in Applicazioni. Study richiede macOS 12 o successivo su un Mac con Apple Silicon. Non esiste una versione per i Mac Intel.

Su **Windows** avvia l'installer `.exe` e segui i passaggi.

## Strumenti facoltativi

Due strumenti da riga di comando ampliano ciò che Study sa leggere. Per iniziare non ti serve nessuno dei due.

- **yt-dlp** permette a Study di prendere l'audio di un link di YouTube e trascriverlo. Study gli chiede solo l'audio, quindi non serve altro.
- **FFmpeg** è l'ultima risorsa per i formati di registrazione insoliti, come AMR o WMA. I formati comuni come MP3, M4A, WAV e l'audio della maggior parte dei video si leggono senza.

Installali con il gestore di pacchetti del tuo sistema, così Study li trova nel percorso.

## Cosa funziona dove

Study svolge il lavoro dei modelli sul tuo piano ChatGPT, quindi la prima volta che lo apri accedi con un account ChatGPT Plus o Pro. Due cose invece funzionano sul tuo computer: la trascrizione delle registrazioni e la ricerca per significato. Ognuna richiede un modello che scarichi dall'app, solo quando lo decidi tu. [Primi passi](../first-steps/) ti accompagna in questo, e [privacy](../privacy/) spiega cosa va dove.

## Aggiornamenti

Study non si aggiorna da solo a tua insaputa. Per cercare una nuova versione apri **Impostazioni › Aggiornamenti** e scegli **Cerca aggiornamenti**. Se ce n'è una, **Installa e riavvia** la scarica e apre la nuova versione. Gli aggiornamenti sono firmati, e Study controlla la firma prima di installarli.

Un aggiornamento sostituisce solo l'app. Il database, i tuoi file e i modelli che hai scaricato restano dove sono, e le attività in background riprendono dopo il riavvio.

## Disinstallare

Rimuovi l'app come faresti con qualsiasi altra sul tuo sistema. I tuoi dati stanno in una cartella separata, che [privacy](../privacy/) indica per ogni piattaforma. Elimina anche quella se non vuoi lasciare niente.
