---
title: Installare Study
description: Scarica Study per Linux, macOS o Windows e tienilo aggiornato.
section: start
order: 1
---

Study è un'app desktop. La installi una volta sul tuo computer, e progetti, file e appunti restano su quel computer. Ogni versione, nella pagina delle release del progetto su GitHub, ha un file da scaricare per ogni piattaforma.

## Scegli il file giusto

| Piattaforma            | File                           |
| ---------------------- | ------------------------------ |
| Linux su Intel o AMD   | `study-linux-x86_64.AppImage`  |
| Linux su ARM           | `study-linux-aarch64.AppImage` |
| macOS su Apple Silicon | `study-macos-aarch64.dmg`      |
| Windows                | `study-windows-x86_64.exe`     |

Su **Linux** l'AppImage è l'app intera. Rendila eseguibile, poi aprila:

```sh
chmod +x study-linux-x86_64.AppImage
./study-linux-x86_64.AppImage
```

Le versioni per Linux sono compilate su Ubuntu 24.04, quindi serve una distribuzione di quell'epoca o più recente.

Su **macOS** apri il `.dmg` e trascina Study in Applicazioni. Study richiede macOS 12 o successivo su un Mac con Apple Silicon. Non esiste una versione per i Mac Intel. Se macOS blocca Study perché non può verificare lo sviluppatore, prova prima ad aprirlo, poi vai in **Impostazioni di Sistema › Privacy e sicurezza**, scegli **Apri comunque** e conferma. Autorizza solo una copia scaricata dalle release di questo progetto.

Su **Windows** avvia l'installer `.exe` e segui i passaggi.

## Collega l'area di lavoro

Puoi iniziare salvando appunti. Collega ChatGPT da **Impostazioni** quando vuoi risposte, trasformazioni delle pagine o esercitazioni generate. [Primi passi](../first-steps/) spiega il percorso nota → pagina → esercitazioni; [privacy](../privacy/) descrive l'archiviazione locale e cosa inviano le richieste ai modelli.

## Aggiornamenti

Scarica l'ultima versione compatibile dalla pagina delle release del progetto su GitHub e installala per la tua piattaforma. Salva il lavoro e chiudi Study prima di sostituire l'applicazione installata.

Conserva un backup del materiale importante usando la sezione dei dati in **Impostazioni**. Aggiornare l'applicazione e ripristinare un backup dell'area di lavoro sono operazioni distinte.

## Disinstallare

Rimuovi l'app come qualsiasi altra applicazione sul tuo sistema. I dati salvati sono separati dall'installazione. Vedi [privacy](../privacy/) per i backup e la rimozione del lavoro salvato.
