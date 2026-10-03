# Contributing

Thank you for helping with Study.

- **Read [AGENTS.md](AGENTS.md) first.** Its golden rules, crate map and commands apply to
  people as much as to agents.
- **Set up** in the devcontainer, or on your own Linux machine; the [README](README.md) says
  how.
- **One branch per change.** Open a pull request to `main`; nothing goes to `main` directly.
- **Run `just check` before you push.** It is what CI runs: formatting, Clippy with warnings
  denied, every test and the API docs. Some tests run real services in Docker.
- **The README demo is recorded by hand.** Run the Demo workflow from the Actions tab; it
  records `assets/demo.gif` with `just demo` and opens a pull request with the new GIF.
- **Every visible word comes from `study-localization`, in English and Italian.** If you
  can't write the Italian, say so in the pull request.
- **Report a vulnerability privately**, as [SECURITY.md](SECURITY.md) says, never in an
  issue.

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Unless you explicitly state otherwise, any contribution you intentionally submit for
inclusion in Study, as defined in the Apache-2.0 license, is dual licensed as in the
[README](README.md#license), without any additional terms or conditions.
