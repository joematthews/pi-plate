# Contributing to pi-plate

The tooling here is set up so that review can be about substance. Formatting, import order, spelling, and type errors are all settled before a diff reaches anyone.

```sh
npm install     # also installs the git hooks
npm run check   # everything CI would check
```

## One command to trust

`npm run check` runs the full gate, in the order that fails cheapest first:

| Step     | Command                | What it settles                             |
| -------- | ---------------------- | ------------------------------------------- |
| Types    | `npm run typecheck`    | `tsc --noEmit` against the pi extension API |
| Lint     | `npm run lint`         | ESLint with type-aware rules                |
| Format   | `npm run format:check` | Prettier, non-negotiable                    |
| Spelling | `npm run spell`        | cspell over source, docs, and config        |
| Tests    | `npm test`             | Vitest                                      |

If that passes locally, it passes in review. There is no separate CI configuration to keep in sync.

## Git hooks

Hooks are installed automatically by `npm install` (husky, via the `prepare` script). You don't need to run anything to enable them.

**pre-commit** runs `lint-staged`, which touches only the files you actually staged:

- `*.{ts,mjs,cjs,js}` -> `eslint --fix`, then `prettier --write`
- `*.{json,jsonc,md,yml,yaml}` -> `prettier --write`

Fixes are applied in place and included in the commit. You will not see a "fix formatting" follow-up commit in this repo, because the formatting never lands wrong.

**pre-push** runs `typecheck`, `spell`, and `test`. It's the slower gate, deliberately placed where it costs you once per push rather than once per commit.

To bypass either in an emergency, `--no-verify` works -- but a PR that only passes with it will fail review for the same reason.

## What this means for your pull request

- **Don't hand-format anything.** Prettier owns style. Reviewers will not comment on it, and neither should you.
- **Don't apologize for lint noise.** If `npm run check` is green, the diff is clean.
- **A red pre-push means the PR isn't ready.** Fix it locally; the round trip through review is slower than the round trip through your terminal.
- **New behavior needs a test.** `index.test.ts` covers each note's content and each trigger condition separately, so add to whichever `describe` block matches.
- **New words are cheap.** If cspell flags a real term, add it to `words` in `cspell.json` rather than rephrasing around it.

## Working on the notes

`debug.ts` prints every note the extension can emit, along with what triggers it, against your real environment:

```sh
npx tsx debug.ts        # current directory
npx tsx debug.ts /path  # somewhere else, e.g. a parent of several repos
```

This is the fastest way to see the effect of a change without starting pi.

The tests are organized by note, then by trigger. When you add a fact, add both: what it says, and the condition under which it stays silent. Every note in this extension is conditional, and the silence is as much a feature as the text.

## Style

Match the file you're in. Comments explain _why_ a choice was made, especially where the obvious approach was rejected for a reason that isn't visible in the code -- most of this extension's design exists to avoid breaking a model server's prefix cache, and that constraint is invisible without a note saying so.

Keep prose in comments and docs to plain US-English keyboard characters.
