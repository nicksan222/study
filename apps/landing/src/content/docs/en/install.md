---
title: Install Study
description: Download Study for Linux, macOS or Windows, and keep it up to date.
section: start
order: 1
---

Study is a desktop app. You install it once on your computer, and your projects, files and notes stay on that computer. Each release on the project's GitHub releases page has one download per platform.

## Pick your download

| Platform | File |
|---|---|
| Linux on Intel or AMD | `study-linux-x86_64.AppImage` |
| Linux on ARM | `study-linux-aarch64.AppImage` |
| macOS on Apple Silicon | `study-macos-aarch64.dmg` |
| Windows | `study-windows-x86_64.exe` |

On **Linux**, the AppImage is the whole app. Make it executable, then open it:

```sh
chmod +x study-linux-x86_64.AppImage
./study-linux-x86_64.AppImage
```

The Linux builds are made on Ubuntu 24.04, so they need a distribution of about that age or newer.

On **macOS**, open the `.dmg` and drag Study into Applications. Study needs macOS 12 or later on an Apple Silicon Mac. There is no build for Intel Macs.

On **Windows**, run the `.exe` installer and follow its steps.

## Optional tools

Two command-line tools add to what Study can read. You don't need either to get started.

- **yt-dlp** lets Study take the sound of a YouTube link and transcribe it. Study asks it for the audio only, so this needs nothing else.
- **FFmpeg** is a last resort for unusual recording formats, such as AMR or WMA. Common formats like MP3, M4A, WAV and the sound of most videos are read without it.

Install them with your system's package manager, so Study can find them on your path.

## What runs where

Study does its model work on your ChatGPT plan, so you sign in with a ChatGPT Plus or Pro account the first time you open it. Two things run on your computer instead: transcribing recordings, and search by meaning. Each needs a model that you download from inside the app, only when you choose to. [First steps](../first-steps/) walks through this, and [privacy](../privacy/) says what goes where.

## Updates

Study doesn't update itself behind your back. To look for a new version, open **Settings › Updates** and choose **Check for updates**. If one is available, **Install and restart** downloads it and opens the new version. Updates are signed, and Study checks the signature before installing.

An update replaces only the app. Your database, your files and the models you downloaded stay where they are, and background work picks up again after the restart.

## Uninstall

Remove the app the way you'd remove any other on your system. Your data lives in a separate folder, which [privacy](../privacy/) lists for each platform. Delete that folder too if you want nothing left behind.
