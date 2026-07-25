/**
 * pi-plate -- a pi extension that gives models a surface to stand on: ground truth
 * about the machine, the clock, the repo, and how pi's bash tool actually behaves.
 *
 * Every note is a `<pi-note>` block, one fact per block, and a block appears only
 * when it is warranted. Notes are real, persisted messages, which is what keeps
 * llama.cpp's prefix cache intact: a message written once renders byte-identically on
 * every later call, so the server never reprocesses the conversation.
 *
 * Where each note goes:
 *   - provenance / environment / bash -- static, so they ride the system prompt,
 *     stated once, at position 0 where a byte-stable string costs nothing.
 *   - time / git -- volatile, so they ride a hidden message appended after each user
 *     prompt, at the end of the context where a change costs only the tail.
 *   - bash state notice -- appended to the bash result itself, so it reaches the
 *     model as machine output rather than as a correction from the user.
 */

import { type ExtensionAPI, getShellConfig } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";

/** `customType` on the grounding message. pi uses it to pick a renderer; it never reaches the model. */
export const NOTE_TYPE = "pi-plate-note";

/**
 * The tag the model sees. `pi`, not `pi-plate`: the system prompt tells the model it
 * is "operating inside pi, a coding agent harness", so pi is an established referent,
 * while pi-plate is a proper noun it has never been introduced to. It also sits
 * parallel to the `<summary>` blocks pi itself injects into user turns.
 */
const NOTE_OPEN = "<pi-note>";
const NOTE_CLOSE = "</pi-note>";

/** Wrap one fact in a tag-delimited block. One block per fact, so blocks can be omitted independently. */
export function wrapNote(body: string): string {
  return `${NOTE_OPEN}\n${body}\n${NOTE_CLOSE}`;
}

/** Tools pi enables when a caller does not narrow the list. */
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

/** Whether the bash tool is available this session, honoring `--no-tools` and `-xt bash`. */
export function bashEnabled(selectedTools: string[] | undefined): boolean {
  return (selectedTools ?? DEFAULT_TOOLS).includes("bash");
}

// =============================================================================
// Static notes (system prompt)
// =============================================================================

/** Defines the convention the other notes rely on. Always present, since they are not. */
export const PROVENANCE_NOTE =
  "Notes in <pi-note> blocks are facts about this machine and session, provided by " +
  "the pi harness rather than by the user.";

/**
 * Product names rather than `process.platform` values. The model reasons about command
 * syntax from what it has read, and "macOS" carries far denser associations with BSD
 * userland -- `stat -f`, `sed -i ''` -- than "darwin" does. The kernel name is kept in
 * parentheses so the note still reconciles with what `uname -s` prints.
 */
const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS (Darwin)",
  linux: "Linux",
  win32: "Windows",
};

/** Platform and architecture. Locale and region are omitted: the time note carries both. */
export function buildEnvironmentNote(): string {
  const name = platform();
  return `Environment: ${PLATFORM_NAMES[name] ?? name} ${arch()}`;
}

/**
 * Directive first, explanation second. The model writes execution plans, so a rule of
 * action lands in the register it is already thinking in; a fact about shell semantics
 * has to be translated into one before it can be acted on.
 */
export function buildBashNote(shell: string, root: string): string {
  return (
    "Run multi-step shell work as a single command chained with &&. Each bash call " +
    `starts a new ${shell} in ${root}; cd, export, and shell variables do not carry ` +
    "between calls."
  );
}

/** The static block, assembled once per session so the string stays byte-identical. */
export function buildStaticNotes(root: string, withBash: boolean): string {
  const notes = [PROVENANCE_NOTE, buildEnvironmentNote()];
  if (withBash) {
    notes.push(buildBashNote(getShellConfig().shell, root));
  }
  return notes.map(wrapNote).join("\n");
}

// =============================================================================
// Bash state notice (tool result)
// =============================================================================

/**
 * Not a repeat of the static bash note. That one documents how the tool works; this
 * one reports that a transition just happened, so it stays short and event-shaped.
 */
export function buildBashStateNotice(root: string): string {
  return `That shell has exited; its cd/export/variables are gone. Next call starts fresh in ${root}.`;
}

/**
 * Command heads whose effect lives in the shell and so dies with it: a model that
 * runs one of these often expects the change to still be in force on its next call.
 * A bare `VAR=value` (a whole segment, not a `VAR=value cmd` prefix) is handled
 * separately in `mutatesShellState`. This is a heuristic allowlist, not a parser.
 */
const SHELL_STATE_HEADS = new Set(["cd", "pushd", "popd", "export", "source", "."]);

/**
 * Whether `command` changed shell state a later call might depend on. Splits into
 * simple-command segments on the operators that begin a new command, then checks
 * each segment's head against `SHELL_STATE_HEADS`, plus a bare `VAR=value` segment.
 * A `VAR=value cmd` prefix (transient, scoped to that one command) does not count;
 * a `(cd x)` subshell (does not persist) is left as the head `(cd`, so it is ignored.
 *
 * Splitting ignores quoting, so `echo "a; cd /"` reads as a `cd` and `if cd x; then`
 * does not. Both are advisory-only: the cost is a redundant notice or a missing one.
 */
export function mutatesShellState(command: string): boolean {
  const segments = command.split(/[\n;]|&&|\|\||[|&]/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/);
    const head = tokens[0] ?? "";
    if (SHELL_STATE_HEADS.has(head)) {
      return true;
    }
    if (tokens.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      return true;
    }
  }
  return false;
}

// =============================================================================
// Time note
// =============================================================================

/**
 * Local and UTC, both from JavaScript's own renderings. `toString()` carries weekday,
 * offset, and zone name; `toISOString()` is directly comparable against the ISO
 * timestamps in logs and CI output, so the model never has to convert between them --
 * the arithmetic small models get wrong.
 */
export function buildTimeNote(now: Date = new Date()): string {
  return `Current Time: Local: ${now.toString()}, UTC: ${now.toISOString()}`;
}

// =============================================================================
// Git note
// =============================================================================

export interface GitState {
  /** Branch name, or undefined when HEAD is detached. */
  branch?: string;
  /** Short HEAD sha, or undefined on an unborn branch (no commits yet). */
  head?: string;
  dirtyCount: number;
  /** Upstream ref (e.g. `origin/main`), or undefined when none is tracked. */
  upstream?: string;
  ahead: number;
  behind: number;
}

/** A repo found at or beside the working directory. */
export interface RepoState {
  /** Child directory name, when the repo was found by scanning siblings. */
  name?: string;
  /**
   * Absolute repo root, set only when it differs from cwd -- that is, when pi was
   * started in a subdirectory. git reports changed paths relative to the root, so
   * without this the model cannot resolve them from where it is standing.
   */
  root?: string;
  state: GitState;
}

/**
 * Parse `git status --porcelain=v2 --branch`. One command carries branch, oid,
 * upstream, ahead/behind, and every changed entry, so the whole note comes from a
 * single success or is not emitted at all -- there is no partial read that could
 * report "clean" because a second command failed.
 */
export function parseGitStatus(output: string): GitState {
  const OID = "# branch.oid ";
  const HEAD = "# branch.head ";
  const UPSTREAM = "# branch.upstream ";
  const AB = "# branch.ab ";

  const state: GitState = { dirtyCount: 0, ahead: 0, behind: 0 };
  for (const line of output.split("\n")) {
    if (line.startsWith(OID)) {
      const oid = line.slice(OID.length).trim();
      // `(initial)` marks an unborn branch -- a repo with no commits yet.
      state.head = oid === "(initial)" ? undefined : oid.slice(0, 8);
    } else if (line.startsWith(HEAD)) {
      const head = line.slice(HEAD.length).trim();
      state.branch = head === "(detached)" ? undefined : head;
    } else if (line.startsWith(UPSTREAM)) {
      state.upstream = line.slice(UPSTREAM.length).trim();
    } else if (line.startsWith(AB)) {
      const [ahead, behind] = line.slice(AB.length).trim().split(/\s+/);
      state.ahead = Math.abs(Number(ahead)) || 0;
      state.behind = Math.abs(Number(behind)) || 0;
    } else if (line.length > 0 && !line.startsWith("# ")) {
      // Every remaining non-header line is one changed entry (1/2/u/? records).
      state.dirtyCount++;
    }
  }
  return state;
}

/**
 * Read git state for `dir`, or undefined if it is not a work tree, git is missing, or
 * the command times out. Returning undefined is the point: a note that guesses "clean"
 * when git did not answer is worse than no note, because the model is being told to
 * trust it. `--no-optional-locks` keeps git from blocking on a lock file, which is the
 * most likely way this call runs out its timeout.
 */
export function readGitState(dir: string): GitState | undefined {
  try {
    const output = execFileSync(
      "git",
      ["--no-optional-locks", "status", "--porcelain=v2", "--branch"],
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    return parseGitStatus(output);
  } catch {
    return undefined;
  }
}

/** Absolute repo root containing `dir`, or undefined when git cannot say. */
export function readGitRoot(dir: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return undefined;
  }
}

/** Whether git can run at all. Checked before a scan, so a missing git costs one spawn, not N. */
function gitInstalled(): boolean {
  try {
    execFileSync("git", ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Repos at `cwd`, or -- when `cwd` is not in a repo at all -- in its immediate children.
 * Starting pi in a parent holding several checkouts is common enough that reporting
 * nothing there would make the note useless exactly where it is most wanted.
 *
 * A `.git` entry in `cwd` settles it immediately and skips the scan. Otherwise git is
 * still asked, because it walks up on its own and pi is often started in a
 * subdirectory of a repo. Only when git says `cwd` is in no repo do we look sideways.
 *
 * Children are filtered by the presence of `.git` before git is spawned: a stat costs
 * microseconds where a spawn costs milliseconds, which is what makes scanning every
 * child affordable. `.git` is a file rather than a directory in worktrees and
 * submodules, so this tests existence, not type. Nothing is skipped by name -- a repo
 * checked out at `vendor` or `dist` is still a repo.
 */
export function readRepoStates(cwd: string): RepoState[] {
  if (existsSync(join(cwd, ".git"))) {
    const own = readGitState(cwd);
    return own ? [{ state: own }] : [];
  }

  const own = readGitState(cwd);
  if (own) {
    const root = readGitRoot(cwd);
    return [root && root !== cwd ? { root, state: own } : { state: own }];
  }

  if (!gitInstalled()) {
    return [];
  }

  let names: string[];
  try {
    names = readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(cwd, name, ".git")))
      .sort();
  } catch {
    return [];
  }

  const repos: RepoState[] = [];
  for (const name of names) {
    const state = readGitState(join(cwd, name));
    if (state) {
      repos.push({ name, state });
    }
  }
  return repos;
}

/** Describe one repo's state, without the `Git:` label or a name prefix. */
export function describeRepo(state: GitState): string {
  const parts = [state.branch ? `branch ${state.branch}` : "detached HEAD"];
  parts.push(state.head ? `at ${state.head}` : "no commits yet");
  parts.push(state.dirtyCount > 0 ? `${state.dirtyCount} uncommitted changes` : "clean");
  if (state.upstream && (state.ahead > 0 || state.behind > 0)) {
    if (state.ahead > 0) parts.push(`${state.ahead} ahead`);
    if (state.behind > 0) parts.push(`${state.behind} behind`);
    parts[parts.length - 1] += ` of ${state.upstream}`;
  }
  return parts.join(", ");
}

/**
 * Render the repos as one note, or undefined when there are none. Every repo found is
 * listed: naming only some of them would leave the model to assume the omitted ones
 * are irrelevant, and nothing here ranks them. Which directory to start pi in is the
 * user's decision, so the note reports what is there.
 *
 * The parent path is restated for the sibling case because this note rides a turn
 * message, which can sit far from pi's own `Current working directory:` line -- "here"
 * only resolves if that line is still in view.
 */
export function formatGitNote(repos: readonly RepoState[], cwd: string): string | undefined {
  const [first] = repos;
  if (!first) {
    return undefined;
  }
  if (repos.length === 1 && !first.name) {
    const described = `Git: ${describeRepo(first.state)}`;
    return first.root ? `${described}. Repo root: ${first.root}` : described;
  }

  const lines = [`Git: ${repos.length} ${repos.length === 1 ? "repo" : "repos"} in ${cwd}:`];
  for (const repo of repos) {
    lines.push(`${repo.name}: ${describeRepo(repo.state)}`);
  }
  return lines.join("\n");
}

/** The git note for `cwd`, or undefined when nothing there is a repo. */
export function buildGitNote(cwd: string): string | undefined {
  return formatGitNote(readRepoStates(cwd), cwd);
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function piPlate(pi: ExtensionAPI): void {
  // Built once and reused so the appended system prompt is byte-identical every
  // turn. Drift here would change position 0 and invalidate the whole KV cache.
  let staticNotes: string | undefined;
  // The last git note emitted. Restating an unchanged repo adds tokens without
  // adding information, and the last stated value stands until contradicted.
  let lastGitNote: string | undefined;

  pi.on("session_start", () => {
    staticNotes = undefined;
    lastGitNote = undefined;
  });

  pi.on("before_agent_start", (event, ctx) => {
    staticNotes ??= buildStaticNotes(ctx.cwd, bashEnabled(event.systemPromptOptions.selectedTools));

    const notes = [buildTimeNote()];
    const git = buildGitNote(ctx.cwd);
    if (git && git !== lastGitNote) {
      lastGitNote = git;
      notes.push(git);
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${staticNotes}`,
      message: {
        customType: NOTE_TYPE,
        content: notes.map(wrapNote).join("\n"),
        display: false,
      },
    };
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "bash") {
      return undefined;
    }
    const command = event.input.command;
    if (typeof command === "string" && !mutatesShellState(command)) {
      return undefined;
    }
    // Only `content` changes. pi merges a handler's result over the original, so
    // everything omitted here -- the bash tool's truncation metadata among it --
    // carries through untouched, and other extensions' patches survive too.
    return {
      content: [
        ...event.content,
        { type: "text" as const, text: wrapNote(buildBashStateNotice(ctx.cwd)) },
      ],
    };
  });
}
