---
title: Install Study
description: Download Study for Linux, macOS or Windows, and keep it up to date.
section: start
order: 1
---

Study is a desktop app. You install it once on your computer, and your projects, files and notes stay on that computer. Each release on the project's GitHub releases page has one download per platform.

## Pick your download

| Platform               | File                           |
| ---------------------- | ------------------------------ |
| Linux on Intel or AMD  | `study-linux-x86_64.AppImage`  |
| Linux on ARM           | `study-linux-aarch64.AppImage` |
| macOS on Apple Silicon | `study-macos-aarch64.dmg`      |
| Windows                | `study-windows-x86_64.exe`     |

On **Linux**, the AppImage is the whole app. Make it executable, then open it:

```sh
chmod +x study-linux-x86_64.AppImage
./study-linux-x86_64.AppImage
```

The Linux builds are made on Ubuntu 24.04, so they need a distribution of about that age or newer.

On **macOS**, open the `.dmg` and drag Study into Applications. Study needs macOS 12 or later on an Apple Silicon Mac. There is no build for Intel Macs. If macOS blocks Study because the developer cannot be verified, first try opening it, then go to **System Settings › Privacy & Security**, choose **Open Anyway**, and confirm. Only approve a copy you downloaded from this project's releases.

On **Windows**, run the `.exe` installer and follow its steps.

## Connect your workspace

You can start by saving notes. Connect ChatGPT from **Settings** when you want answers, page transformations or generated practice. [First steps](../first-steps/) walks through the note → page → practice workflow; [privacy](../privacy/) explains local storage and what model requests send.

## Updates

Download the latest compatible release from the project's GitHub releases page and install it for your platform. Save your work and close Study before replacing the installed application.

Keep a backup of important material using the data section in **Settings**. Updating the application and restoring a workspace backup are separate operations.

## Uninstall

Remove the app the way you would remove another application on your system. Saved application data is separate from the installation. See [privacy](../privacy/) for backups and removing saved work.
