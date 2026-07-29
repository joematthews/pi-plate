# pi-plate

<img src="https://raw.githubusercontent.com/joematthews/pi-plate/main/illustration.jpg" alt="A slice of cherry pie on a plate, the juices held on the plate rather than the table" width="300" align="right">

A [pi](https://pi.dev) extension that tells the model what it cannot know: the date, the machine, and the state of your git repositories.

The plate does not make the pie. It keeps the juices off the table.

Facts arrive as `<pi-note>` blocks, written into the conversation where the model reads them and you do not. A block appears only when it is warranted, so a session where nothing changes costs nothing after the first turn.

## Install

```sh
pi install npm:pi-plate
```

## Sent after each of your messages

These ride a hidden message appended to your turn, at the end of the context, so a change costs only the tail rather than the whole conversation.

### Git

Inside a repository, the branch, the commit, and how much is uncommitted:

```
<pi-note>
Git: branch main, at 49f84062, 3 uncommitted changes
</pi-note>
```

Start pi in a directory holding several checkouts and it reads all of them:

```
<pi-note>
Git: 3 repos in /Users/you/Code:
api: branch main, at 1c2b3a4d, 2 uncommitted changes
web: branch develop, at 9f8e7d6c, clean, 1 behind of origin/develop
docs: branch main, no commits yet, 1 uncommitted changes
</pi-note>
```

Sent again only when it changes. If git cannot answer -- not a repository, git missing, a command that times out -- pi-plate says nothing rather than guessing.

### Time

```
<pi-note>
Current Time: Local: Wed Jul 29 2026 01:26:00 GMT-0500 (Central Daylight Time), UTC: 2026-07-29T06:26:00.833Z
</pi-note>
```

Local and UTC together, so neither has to be converted to compare against a log line.

## Sent once, in the system prompt

These do not change while pi is running, so they sit at the top where a byte-stable string costs nothing to re-send.

### Machine

```
<pi-note>
Environment: macOS (Darwin) arm64
</pi-note>
```

Which dialect of `stat` and `sed` this is.

### Shell

pi runs every `bash` command in a new shell, so `cd` and `export` do not carry between calls. pi's own tool description does not say so.

```
<pi-note>
Run multi-step shell work as a single command chained with &&. Each bash call starts a new /bin/bash in /Users/you/Code; cd, export, and shell variables do not carry between calls.
</pi-note>
```

## Requirements

- [pi](https://pi.dev), any version exposing `before_agent_start`
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

`npm run check` runs typecheck, lint, format, spell, and tests. `npx tsx debug.ts` prints every note pi-plate would inject, and what triggers each one.

## License

[MIT](LICENSE) (c) Joe Matthews
