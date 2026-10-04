---
title: Privacy and your data
description: What stays on your computer, what goes to your ChatGPT plan, and where Study keeps your files.
section: more
order: 2
---

Study is local-first. Your projects, sessions, files and recordings live in one database on your computer. There is no Study account and no Study server. When a task needs a language model, Study sends it to your own ChatGPT plan, and only what that task needs.

## What runs on your ChatGPT plan

These tasks are sent to ChatGPT, under the account you signed in with:

- reading PDF pages and pictures
- correcting transcripts
- naming sessions
- answering notes that mention @study
- writing flashcards and diagrams
- writing practice questions and grading your answers

Each request carries the text or pages that task needs, such as the passages an answer cites from. The plan's own terms and usage limits apply, as they do in ChatGPT. You can sign out at any time in **Settings › Language models** with **Sign out**.

## What runs on your computer

Two things never leave your computer:

- **Transcription.** Recordings are turned into text by a speech model running locally. It's about 670 MB to download and uses about 2 GB of memory for each copy you run. **Model copies** in **Settings › Transcription** sets how many run at once.
- **Search by meaning.** A multilingual model of about 135 MB turns your text into something search can compare. See [search](../search/).

The audio of your recordings stays on your computer. Only the transcript is sent on, if you leave **Correct transcripts with AI** on.

## Downloads

Study downloads nothing on its own. The two local models come from Hugging Face, and only when you choose to install them, either during the welcome tour or in **Settings › This computer**. App updates download only when you choose **Install and restart**.

## Other network use

- **Add link** fetches the web page you give it, directly from your computer.
- For a YouTube link, Study runs yt-dlp on your computer to fetch the sound.

## Where your data lives

Study keeps your database and its log in one folder, and the downloaded models in another.

| Platform | Database and log | Models |
|---|---|---|
| Linux | `~/.local/share/study/` | `~/.cache/study/models/` |
| macOS | `~/Library/Application Support/Study/` | `~/Library/Caches/Study/models/` |
| Windows | `%LOCALAPPDATA%\Study\data\` | `%LOCALAPPDATA%\Study\cache\models\` |

On Linux, `XDG_DATA_HOME` and `XDG_CACHE_HOME` move these folders if you've set them.

The data folder holds `study.sqlite3`, the database, and `diagnostics.log`, a log that can help when something goes wrong. On Linux and macOS, the folder can be opened only by your user account.

## Keeping or removing it

To back up your work, copy the data folder while Study is closed. To remove everything, quit Study and delete both folders. Updating the app never touches them.
