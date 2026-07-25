# pi-plate

**Give your coding agent the facts it can't know.** A [pi](https://pi.dev) extension that quietly tells the model what time it is, what machine it's on, which git repositories are in front of it, and how pi's `bash` tool really behaves.

Built for small local models -- Gemma, Qwen, Llama running on [llama.cpp](https://github.com/ggml-org/llama.cpp) -- where a wrong assumption turns straight into a wrong action. Cloud models benefit too, because some of these facts aren't in any model's weights at any size.

```sh
git clone https://github.com/joematthews/pi-plate
cd pi-plate && npm install && pi install .
```

Restart pi. That's the whole setup.

## The problem

Ask a model to add a copyright notice and it writes **2024**. Ask what changed in your repo and it guesses. Tell it to `cd` into a folder and it assumes it's still there on the next command.

None of that is the model being bad at coding. It's a model with no senses, filling gaps with the most probable-looking answer. In a chat that's a wrong sentence. In a coding agent it's a wrong file, in the wrong directory, committed to the wrong branch.

In a side-by-side run on Gemma 4 E4B, the same prompt produced a **2024** copyright line without pi-plate and **2026** with it -- no hesitation, no deliberation, just the right year.

## What your model gets

Facts arrive as `<pi-note>` blocks. One fact per block, and **a block only appears when it's warranted** -- no filler on turns where nothing is relevant.

### The current date and time

The single most common thing models get wrong: searching for last year's information, reasoning about "today" from a training cutoff, telling you you've been at it all night when it's the middle of the afternoon.

```
Current Time: Local: Sat Jul 25 2026 15:18:21 GMT-0500 (Central Daylight Time), UTC: 2026-07-25T20:18:21.293Z
```

Local and UTC together, so the model never has to convert between them when comparing against a log line or a CI timestamp -- arithmetic small models routinely get wrong.

### Git status, including monorepos

Inside a repository, it gets the branch, the commit, and how much is uncommitted:

```
Git: branch main, at 49f84062, 3 uncommitted changes
```

Start pi in a **parent directory holding several checkouts** and it reads all of them:

```
Git: 3 repos in /Users/you/Code:
api: branch main, at 1c2b3a4d, 2 uncommitted changes
web: branch develop, at 9f8e7d6c, clean, 1 behind of origin/develop
docs: branch main, no commits yet, 1 uncommitted changes
```

Every repository is listed -- nothing is summarized away, because nothing here ranks them and you chose the directory. It updates only when something actually changes.

If git can't answer -- not a repository, git not installed, a command that times out -- pi-plate says **nothing at all** rather than guessing. A note claiming "clean" on a dirty tree is worse than no note, because the whole point is that the model trusts it.

### The working directory and shell

pi runs every `bash` command in a brand-new shell. `cd`, `export`, and variables never survive to the next call, which is why this silently fails:

```sh
cd src        # runs, then the shell exits
npm install   # fresh shell, back at the project root -- wrong folder
```

pi's own tool description doesn't mention this, so models plan around it as if it were an interactive terminal. pi-plate states the rule up front, names the shell pi will actually use, and adds a short reminder after any command that changed shell state.

### The platform

```
Environment: macOS (Darwin) arm64
```

Enough for the model to know that `stat -f%z` and `sed -i ''` are the local dialect, not the GNU ones.

## What you'll see

Almost nothing. The date, git, and platform notes never appear in your terminal -- they're delivered to the model only, so your transcript stays readable.

The one exception is the shell reminder, which shows up attached to the `bash` output it belongs to. That's deliberate: it reaches the model as machine output rather than as a correction from you, which small models tend to over-react to.

## Fast on local models

pi-plate costs about **230 tokens once**, then effectively nothing. Notes are written into the conversation rather than re-stitched onto every request, so llama.cpp keeps its prefix cache and never reprocesses your session. In measured runs, every request after the first processed only the handful of new tokens, not the whole conversation.

## Requirements

- [pi](https://pi.dev) 0.81 or later
- Node.js 20+
- git (optional -- the git note is simply skipped without it)

Works with any model pi can talk to, local or hosted.

## Honest limits

pi-plate reliably supplies facts the model can't know. The date and git notes work immediately and need no coaxing.

It's less reliable at overriding a habit. When a model reaches for a Linux `stat` flag on a Mac, having the platform in context doesn't consistently stop the first attempt -- though it does shorten the recovery, since the model has the right fact to hand once something fails.

Measurements so far are small-sample, on one model. Treat this as a reasoned default, not a proven one.

## License

[MIT](LICENSE) (c) Joe Matthews
