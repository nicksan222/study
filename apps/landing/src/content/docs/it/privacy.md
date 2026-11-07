---
title: Privacy e dati
description: Comprendi l'archiviazione locale, cosa viene inviato a ChatGPT e come conservare un backup.
section: reference
order: 5
---

Study conserva l'area di lavoro salvata in un database SQLite sul tuo computer. Materie, sessioni, documenti ed esercitazioni salvate appartengono a quell'area locale. L'app desktop esegue un proprio processo server privato per l'interfaccia e i servizi dell'applicazione.

## Cosa va a ChatGPT

Quando richiedi lavoro ai modelli, Study usa la connessione a ChatGPT configurata. Secondo l'attività, le richieste possono contenere fonti, appunti salvati, testo dei documenti selezionati, istruzioni o una risposta a un'esercitazione.

Alcuni esempi sono leggere materiale sorgente supportato, rispondere a una domanda, trasformare sessioni in un documento, generare esercitazioni e valutare risposte scritte. Il contenuto necessario a queste operazioni lascia l'area locale per essere elaborato dal fornitore.

Usa **Impostazioni** per controllare l'account collegato e disconnetterti quando vuoi. Al lavoro inviato tramite il piano si applicano il suo accesso e i suoi limiti di utilizzo.

## Contenuto locale e rete

Salvare un appunto è un'azione distinta dal chiedere una risposta o una trasformazione. Controlla il materiale selezionato prima di avviare il lavoro dei modelli, soprattutto se contiene informazioni personali o sensibili.

Anche recuperare un link usa la rete per contattare la fonte fornita. L'archiviazione locale non implica che ogni operazione sia offline. Controlla lo stato senza dare per scontato che un file conservato sia stato elaborato in locale.

## Dove stanno i dati

L'app desktop usa la cartella dei dati dell'applicazione prevista dal sistema operativo. Il nome predefinito del database è `study.sqlite`. Gli ambienti di sviluppo e quelli configurati esplicitamente possono usare una posizione diversa.

Usa i comandi per dati e backup dell'app invece di affidarti a percorsi di una guida precedente. File originali, materiale estratto e documenti hanno ruoli distinti; controlla cosa contiene un backup prima di ripristinarlo.

## Conserva un backup

Apri **Impostazioni** e trova la sezione dei dati. Crea un backup, controlla quelli salvati o importa un file `.studybackup`. Rivedi l'anteprima del ripristino e la conferma prima di sostituire dati.

Un backup locale sullo stesso computer aiuta il recupero, ma conservarne un'altra copia esportata altrove protegge dalla perdita del computer. Conserva i backup in modo adeguato alla sensibilità dei contenuti.

## Rimuovere l'app

Disinstallare l'applicazione ed eliminare i dati salvati sono azioni distinte. Prima crea un backup di ciò che ti serve. Usa i comandi dei dati disponibili e la posizione dei dati dell'applicazione del sistema operativo quando intendi rimuovere anche il lavoro salvato.
