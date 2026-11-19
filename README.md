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
and the passages that answers and study material come from. Study keeps your database on your
computer. Pair your phone to send notes and photos from the mobile capture screen to Study
on your computer over WebRTC. Public signaling relays help the paired devices find each other.
Speech-to-text and search models download only when you choose to.

## Contribute

Study is built in the open, and contributions are welcome. Start with
[CONTRIBUTING.md](.github/CONTRIBUTING.md).

The browser and Tauri desktop app use the React application in `apps/client`. Study Mobile
owns its pages and features in `apps/mobile` and uses the shared client operations. Each app
registers its modules at startup. The client provides page boundaries, background components,
settings sections and page actions for those modules. Desktop and Mobile each own their side
of pairing and share its wire protocol. The desktop shell runs a private TypeScript server. Application services expose
typed Effect RPC contracts and use Drizzle over one local SQLite database. Model calls
use your ChatGPT provider sign-in. The accepted structure and tradeoffs are recorded in
[Shared application client](doc/adr/shared-application-client.md).

## License

[Apache 2.0](.github/LICENSE-APACHE) or [MIT](.github/LICENSE-MIT), at your option.
[NOTICE](.github/NOTICE) lists bundled third-party files.
