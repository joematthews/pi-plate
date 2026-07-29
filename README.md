# pi-plate

A [pi](https://pi.dev) extension that tells the model the things it cannot know: the date, the machine, and the state of your git repositories.

Models fill gaps with the most probable-looking answer. That is a wrong sentence in a chat and a wrong file, on the wrong branch, in a coding agent. pi-plate states the facts instead, as `<pi-note>` blocks the model reads and you never see.

## Install

```sh
pi install npm:pi-plate
```

Then restart pi.

## What the model gets

**The date and time**, local and UTC together:

```
Current Time: Local: Tue Jul 28 2026 23:50:14 GMT-0500 (Central Daylight Time), UTC: 2026-07-29T04:50:14.289Z
```

**Git state.** One repo when you start pi inside one:

```
Git: branch main, at 49f84062, 3 uncommitted changes
```

Every repo when you start pi in a directory of checkouts:

```
Git: 3 repos in /Users/you/Code:
api: branch main, at 1c2b3a4d, 2 uncommitted changes
web: branch develop, at 9f8e7d6c, clean, 1 behind of origin/develop
docs: branch main, no commits yet, 1 uncommitted changes
```

The git note is sent again only when something in it changes, so an unchanged repo costs nothing.

**The platform**, so the model knows which dialect of `stat` and `sed` it is talking to:

```
Environment: macOS (Darwin) arm64
```

**How bash behaves.** pi runs every command in a new shell, so `cd` and `export` do not carry between calls. pi's own tool description does not say so:

```
Run multi-step shell work as a single command chained with &&. Each bash call starts a
new zsh in /Users/you/Code; cd, export, and shell variables do not carry between calls.
```

## What you see

Nothing. Every note is delivered to the model, not to your terminal.

## Requirements

- [pi](https://pi.dev) 0.81 or later
- git, optionally -- the git note is skipped without it

Works with any model pi can talk to, local or hosted.

## Limits

pi-plate states facts. It does not override habits: knowing the platform does not reliably stop a model reaching for a GNU flag on a Mac, though it does shorten the recovery.

Scanning a directory of checkouts costs one `git status` per repo per turn -- about 37 ms for three repos, 155 ms for six.

## Development

Run from a local clone instead of the registry:

```sh
git clone https://github.com/joematthews/pi-plate
cd pi-plate
npm install
pi install .
```

Then restart pi.

`npm run check` runs typecheck, lint, format, spell, and tests.

## License

[MIT](LICENSE) (c) Joe Matthews
