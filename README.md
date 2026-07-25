# pi-plate

A [pi](https://pi.dev) extension that gives a model a surface to stand on: the facts
it otherwise guesses at — what machine it's on, what time it is, what the repo looks
like, and how pi's `bash` tool actually behaves.

Built for small local models like Gemma 4, where a wrong assumption becomes a wrong
action and there's little spare capacity to recover from it. Larger models benefit
from the same notes, because some of these facts aren't in any model's weights: no
amount of scale tells you the current time or which branch you're on.

The goal is that the model never _thinks_ about any of this. The facts should be
available, not prominent — reached for when relevant, and otherwise invisible.

## What it adds

Every fact is a `<pi-note>` block, one fact per block, and **a block appears only when
it is warranted**. In a clean repo, on a turn with no state-changing command, the only
thing added is the time.

The tag says `pi`, not `pi-plate`. pi's system prompt already tells the model it is
"operating inside pi, a coding agent harness", so `pi` is a referent it knows, while
`pi-plate` is a proper noun it has never been introduced to. It also sits parallel to
the `<summary>` blocks pi itself injects into user turns.

### Stated once, in the system prompt

```
<pi-note>
Notes in <pi-note> blocks are facts about this machine and session, provided by the
pi harness rather than by the user.
</pi-note>
<pi-note>
Environment: darwin arm64
</pi-note>
<pi-note>
Run multi-step shell work as a single command chained with &&. Each bash call starts
a new /bin/bash in /Users/you/project; cd, export, and shell variables do not carry
between calls.
</pi-note>
```

These are static, so they belong at position 0 where a byte-stable string costs
nothing to repeat. It's also the one channel where the truthful author and the actual
author match — the harness speaking as the harness, no disclaimer needed.

The bash block is omitted entirely when the bash tool isn't enabled. It leads with the
directive rather than the explanation because the observed failures were _plans_: the
model writes an execution plan, and a rule of action lands in that register while a
fact about shell semantics has to be translated into one first.

The shell path comes from pi's own `getShellConfig()`, so it names the shell pi will
actually use — which on macOS is `/bin/bash`, not your login shell.

### Attached to each prompt, hidden from the TUI

```
<pi-note>
Current Time: Local: Sat Jul 25 2026 15:18:21 GMT-0500 (Central Daylight Time), UTC: 2026-07-25T20:18:21.293Z
</pi-note>
<pi-note>
Git: branch main, at 49f84062, 3 uncommitted changes
</pi-note>
```

**Time** is the reason this extension exists. It's the single most common thing a
model gets wrong: searching for last year's information, reasoning about "today" from
a training cutoff, telling you you've been working all night when it's midday. Both
renderings come from JavaScript's own `toString()` and `toISOString()` — local carries
the weekday, offset, and zone name; UTC is directly comparable against the ISO
timestamps in logs and CI output, so the model never has to do the conversion.

**Git** appears only inside a repo, and only when it has _changed_ since it was last
stated. The previous value stands until contradicted, so restating an unchanged repo
would add tokens without adding information.

Start pi in a parent directory holding several checkouts and it scans one level down,
describing the repos that are notable and counting the rest:

```
Git: 4 repos here. api: branch main, at 1c2b3a4d, 2 uncommitted changes. web: branch
dev, at 9f8e7d6c, clean, 1 behind of origin/dev. 2 others clean.
```

If git doesn't answer — not a repo, no git, or a timeout — pi-plate says **nothing**
rather than guessing. A note claiming "clean" on a dirty tree is worse than no note,
because the whole point is that the model trusts it.

### Attached to a bash result that changed shell state

```
<pi-note>
That shell has exited; its cd/export/variables are gone. Next call starts fresh in
/Users/you/project.
</pi-note>
```

This one is visible in the TUI, because it genuinely is part of that command's result.
The placement is deliberate: it reaches the model as machine output rather than as a
correction from you, which a small model is prone to over-steer on.

It is not a repeat of the static bash block. That one documents how the tool works;
this one reports that a transition just happened, so it stays short. It fires only
after a `cd`, `export`, `source`, or bare `VAR=value` — after `ls` there's nothing to
carry over, and reminding on every command would just train the model to skim past it.

## Install

```sh
git clone https://github.com/joematthews/pi-plate
cd pi-plate
npm install
pi install .
```

Then restart pi.

## Development

```sh
npm run check     # typecheck, lint, format, spell, test
npx tsx debug.ts  # print every note, and what triggers it
```

`eval/` holds an A/B harness that runs a task against a local model with the extension
installed and uninstalled, scoring the resulting filesystem and scanning the model's
reasoning for mentions of the notes. It needs a running llama.cpp server and is not
part of `npm run check`.

## How it works

**Notes are real messages.** This is the load-bearing decision. pi-plate does not edit
the throwaway copy of the conversation that pi hands each model call; it appends real,
persisted messages and amends the system prompt. A message written once renders
byte-identically on every later call, so llama.cpp's prefix cache stays valid.

Editing the throwaway copy is tempting, since notes then never touch the transcript at
all — but it silently breaks that cache. A note attached to your newest message
vanishes from it on the next turn, which changes the token stream near the front of
the context and forces a full reprocess every turn. On a local model that's seconds
you can feel.

That gives the placement rule everything else follows from:

> Static facts go as early as possible — position 0, byte-stable, free forever.
> Volatile facts go as late as possible — appended at the end, where a change costs
> only the tail.

**Where the notes live.** `display: false` hides a message from the TUI, not from
disk. The grounding notes are written to the session `.jsonl`. That's deliberate: a
note you can't see influencing the model is a debugging hazard, and persistence is
what keeps the cache intact.

**Appending to the system prompt is cooperative.** pi threads the prompt through every
extension in turn, so pi-plate appends to whatever it receives rather than replacing
it. Returning a bare string would discard pi's base prompt and every other extension's
contribution.

**Git is read, never written.** One `git --no-optional-locks status --porcelain=v2
--branch` per repo carries branch, oid, upstream, ahead/behind, and every changed
entry. One command rather than five means there is no partial read that could report
"clean" because a later command failed.

**Attribution.** The volatile notes reach the model in a user turn — pi maps custom
messages to `role: "user"` on the wire, and there is no harness role available
mid-conversation. The `<pi-note>` tag does the work a role would. The other two notes
don't need it: the system prompt _is_ the harness, and a bash result _is_ machine
output.

## What we know and don't

Across three runs against Gemma 4 E4B, the model mentioned the notes **zero** times in
roughly 9,500 characters of reasoning — no references to the tag, the environment, or
the time, and nothing attributing any of it to the user. That's the bar this extension
is built to: available, not prominent.

What we have not measured is whether the notes make the model _more correct_. One run
made a stateless-shell error while the reminder was already in its context, then
recovered using the reminder's own language — which is consistent with the note
helping, and equally consistent with the error message alone being enough. Treat the
whole thing as a reasoned default, not a proven one.

## License

[MIT](LICENSE) (c) Joe Matthews
