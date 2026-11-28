<div align="center">

<img src="packages/ui/assets/logo/study.svg" width="88" height="88" alt="">

# Study

**A calm place for everything you learn.**

Write in a notebook, upload your source files, and use your saved material to generate
study notes, flashcards and quizzes.

[Website](https://nicksan222.github.io/study/) ·
[First steps](https://nicksan222.github.io/study/docs/first-steps/) ·
[Download](https://github.com/nicksan222/study/releases) ·
[Contribute](.github/CONTRIBUTING.md) ·
[Report a bug](https://github.com/nicksan222/study/issues)

</div>

## Why Study

- **Notes and materials by subject.** Write in [Notes](https://nicksan222.github.io/study/docs/notes/)
  and upload original files in [Materials](https://nicksan222.github.io/study/docs/sources/).
- **Answers you can check.** Ask the notebook Assistant about your material and follow
  citations to the passages behind an answer.
- **Study material from your sources.** Use [Practice](https://nicksan222.github.io/study/docs/practice/)
  to generate editable study notes, spaced-repetition flashcards and quizzes.
- **Yours, on your computer.** Your saved library lives in one local database.
- **No extra AI bill.** Sign in with your ChatGPT Plus or Pro plan. No API keys, no
  subscription to us.
- **Free and open source.** MIT or Apache 2.0, your choice.

Built for university students juggling several courses, self-learners, and anyone studying
for a certification.

## Get Study

Download it from [Releases](https://github.com/nicksan222/study/releases) for Linux,
macOS (Apple Silicon) or Windows. On Linux, you need Ubuntu 24.04, Debian 13 or newer.
Study offers signed updates that you can install from the app.

> Study is in early development. Expect rough edges, and tell us about them.

## Your privacy

Model work uses your ChatGPT connection and sends the material needed for the task,
such as selected source content, notebook text or a quiz answer. Study saves your library
in a local database. Dictation runs locally after you install a speech model in Settings.

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
