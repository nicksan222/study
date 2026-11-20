<div align="center">

<img src="packages/ui/assets/logo/study.svg" width="88" height="88" alt="">

# Study

**A calm place for everything you learn.**

Bring your lectures, slides and PDFs. Study reads them, answers your questions with
citations, and turns them into flashcards and practice.

[Website](https://nicksan222.github.io/study/) ·
[Download](https://github.com/nicksan222/study/releases) ·
[Contribute](.github/CONTRIBUTING.md) ·
[Report a bug](https://github.com/nicksan222/study/issues)

![An older Study tour, including the retired diagram feature](https://nicksan222.github.io/study/demo.gif)

Older tour: this recording includes features that have since been removed.

</div>

## Why Study

- **Everything in one place.** Recordings, slides, PDFs, pictures, pages, web pages and
  YouTube videos, organized by course.
- **Answers you can check.** Ask anything about your material. Every answer cites the page,
  or the exact moment in the recording.
- **Study material, made for you.** Notes, flashcards on a spaced-repetition
  schedule, and quizzes that grade your answers.
- **Yours, on your computer.** Your library lives in one local database. Transcription and
  search run on your machine.
- **No extra AI bill.** Sign in with your ChatGPT Plus or Pro plan. No API keys, no
  subscription to us.
- **Free and open source.** MIT or Apache 2.0, your choice.

Built for university students juggling several courses, self-learners, and anyone studying
for a certification.

## Get Study

Download it from [Releases](https://github.com/nicksan222/study/releases) for Linux,
macOS (Apple Silicon) or Windows. On Linux, you need Ubuntu 24.04, Debian 13 or newer.
Study updates itself, and every update is signed.

Optional: [yt-dlp](https://github.com/yt-dlp/yt-dlp) for YouTube videos, and FFmpeg for rare
recording formats.

> Study is in early development. Expect rough edges, and tell us about them.

## Your privacy

Only what the models need goes to OpenAI, through your own ChatGPT plan: the pages to read
and the passages that answers and study material come from. Your recordings and database
stay on your computer by default. Speech-to-text and search models download only when you
choose to.

You can turn on daily backups in **Settings → Data & backups**. Study rotates through seven
backup names for the active installation. Turning backups off leaves existing copies in
the destination. Provider version history and retention policies may keep older versions.
Cloud copies are unencrypted Study backup files with sign-in credentials removed. Download
a `.studybackup` file from the destination and import it in the same settings panel.

| Destination                  | Setup                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| This device or synced folder | Save locally, or choose an existing folder managed by a sync client such as iCloud Drive.                                                                                                                                                                                                  |
| OneDrive Personal            | Use an [Entra public client registration][onedrive-registration] for personal accounts. Add the mobile and desktop redirect `http://localhost/study-backup` and delegated Graph permission `Files.ReadWrite.AppFolder`. Paste the client ID. Files appear under **Apps**.                  |
| Google Drive                 | Enable the Drive API and create a [Desktop OAuth client][google-registration]. Paste its ID and secret. Study requests `drive.file` and writes to **My Drive**. An external app in Testing issues refresh tokens that expire after seven days. Publishing can require Google verification. |
| Dropbox                      | Create a [scoped App Folder app][dropbox-registration] with `files.content.write`. Register `http://localhost:42819/study-backup` and paste its app key. Files appear under **Apps**. Dropbox has separate rules for distributing a shared registration.                                   |
| S3-compatible storage        | Enter a bucket, signing region, and access keys with write access. Leave endpoint blank for AWS or supply an HTTPS service endpoint for Cloudflare R2, Backblaze B2, Wasabi, MinIO, or Google Cloud Storage with HMAC interoperability. An object prefix is optional.                      |
| WebDAV                       | Enter the HTTPS URL of an existing folder, a username, and an app password. The folder must allow uploading and renaming files. Use a server such as Nextcloud or ownCloud.                                                                                                                |
| Azure Blob Storage           | Enter the HTTPS URL of an existing container and a write-capable SAS token. An object prefix is optional.                                                                                                                                                                                  |

After restoring a backup, configure the destination again. Copies from the previous
backup rotation remain in its destination.

[onedrive-registration]: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
[google-registration]: https://developers.google.com/identity/protocols/oauth2/native-app
[dropbox-registration]: https://developers.dropbox.com/oauth-guide

## Contribute

Study is built in the open, and contributions are welcome. Start with
[CONTRIBUTING.md](.github/CONTRIBUTING.md).

The shared React application in `apps/client` runs in the browser and the Tauri desktop
host. The desktop shell runs a private TypeScript server; application services expose
typed Effect RPC contracts and use Drizzle over one local SQLite database. Model calls
use your ChatGPT provider sign-in. The accepted structure and tradeoffs are recorded in
[Shared application client](doc/adr/shared-application-client.md).

## License

[Apache 2.0](.github/LICENSE-APACHE) or [MIT](.github/LICENSE-MIT), at your option.
[NOTICE](.github/NOTICE) lists bundled third-party files.
