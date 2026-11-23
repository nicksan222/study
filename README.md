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
