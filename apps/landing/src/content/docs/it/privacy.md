---
title: Privacy e dati
description: Cosa resta sul tuo computer, cosa va al tuo piano ChatGPT, e dove Study tiene i tuoi file.
section: more
order: 2
---

Study lavora in locale. Progetti, sessioni, file e registrazioni stanno in un unico database sul tuo computer. Non esiste un account Study né un server Study. Quando un'attività ha bisogno di un modello linguistico, Study la manda al tuo piano ChatGPT, e solo quello che serve a quell'attività.

## Cosa usa il tuo piano ChatGPT

Queste attività vengono mandate a ChatGPT, con l'account con cui hai effettuato l'accesso:

- leggere le pagine dei PDF e le immagini
- correggere le trascrizioni
- dare un nome alle sessioni
- rispondere agli appunti che menzionano @study
- scrivere flashcard e schemi
- scrivere le domande delle esercitazioni e correggere le tue risposte

Ogni richiesta porta il testo o le pagine che servono a quell'attività, per esempio i passaggi da cui cita una risposta. Valgono i termini e i limiti di utilizzo del piano, come in ChatGPT. Puoi uscire in qualsiasi momento da **Impostazioni › Modelli linguistici** con **Esci**.

## Cosa gira sul tuo computer

Due cose non lasciano mai il tuo computer:

- **La trascrizione.** Le registrazioni diventano testo grazie a un modello vocale che gira in locale. Da scaricare pesa circa 670 MB e usa circa 2 GB di memoria per ogni copia in funzione. **Copie del modello** in **Impostazioni › Trascrizione** decide quante ne girano insieme.
- **La ricerca per significato.** Un modello multilingue di circa 135 MB trasforma il tuo testo in qualcosa che la ricerca può confrontare. Vedi [ricerca](../search/).

L'audio delle tue registrazioni resta sul tuo computer. Viene inviata solo la trascrizione, se lasci attiva **Correggi le trascrizioni con l'IA**.

## Download

Study non scarica niente di sua iniziativa. I due modelli locali arrivano da Hugging Face, e solo quando scegli di installarli, durante il tour di benvenuto o in **Impostazioni › Questo computer**. Gli aggiornamenti dell'app si scaricano solo quando scegli **Installa e riavvia**.

## Altri usi della rete

- **Aggiungi link** scarica la pagina web che gli dai, direttamente dal tuo computer.
- Per un link di YouTube, Study esegue yt-dlp sul tuo computer per prenderne l'audio.

## Dove stanno i tuoi dati

Study tiene il database e il suo log in una cartella, e i modelli scaricati in un'altra.

| Piattaforma | Database e log | Modelli |
|---|---|---|
| Linux | `~/.local/share/study/` | `~/.cache/study/models/` |
| macOS | `~/Library/Application Support/Study/` | `~/Library/Caches/Study/models/` |
| Windows | `%LOCALAPPDATA%\Study\data\` | `%LOCALAPPDATA%\Study\cache\models\` |

Su Linux, `XDG_DATA_HOME` e `XDG_CACHE_HOME` spostano queste cartelle se le hai impostate.

La cartella dei dati contiene `study.sqlite3`, il database, e `diagnostics.log`, un log che può aiutare quando qualcosa va storto. Su Linux e macOS la cartella è accessibile solo dal tuo account utente.

## Conservare o eliminare

Per fare un backup del tuo lavoro, copia la cartella dei dati mentre Study è chiuso. Per eliminare tutto, chiudi Study ed elimina entrambe le cartelle. Aggiornare l'app non le tocca mai.
