---
title: Privacy and your data
description: Understand local storage, what model work sends to ChatGPT and how to keep a backup.
section: reference
order: 5
---

Study keeps your saved workspace in a SQLite database on your computer. Subjects, notes, pages and saved practice belong to that local workspace. The desktop app runs its own private server process to serve the interface and application services.

## What goes to ChatGPT

When you request model work, Study uses the ChatGPT connection you configured. Depending on the task, requests can include source content, saved notes, selected page text, your instructions or a practice answer.

Examples include reading supported source material, answering a question, transforming notes into a page, generating practice and grading written answers. The content needed for these operations leaves the local workspace for processing by the provider.

Use **Settings** to review the connected account and sign out when you want to disconnect. Your plan's access and usage limits apply to the work you send through it.

## Local content and network access

Saving a note is distinct from asking for an answer or a transformation. Review the material you select before starting model work, especially when it contains personal or sensitive information.

Fetching a link also uses the network to contact the source you supplied. Local storage does not mean that every operation is offline. Check an operation's status rather than assuming that a stored file has been processed locally.

## Where your data lives

The desktop app uses the operating system's application data directory. Its default database filename is `study.sqlite`. Development and explicitly configured environments can use a different database location.

Use the app's data and backup controls rather than relying on paths from an older installation guide. Original source content, extracted material and authored pages have distinct roles; review what a backup contains before restoring it.

## Keep a backup

Open **Settings** and find the data section. Create a backup, inspect saved backups or import a `.studybackup` file. Review the restore preview and confirmation before replacing data.

A local backup on the same computer is useful for recovery, but keeping another copy of an exported backup elsewhere protects against losing that computer. Store backups according to the sensitivity of their content.

## Removing the app

Uninstalling the application and deleting its saved data are separate actions. Back up anything you need first. Use the available data controls and the operating system's application data location when you intend to remove saved work as well.
