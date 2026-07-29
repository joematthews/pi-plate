/**
 * pi-plate -- facts about the machine, the clock and the repo, delivered to the model
 * as `<pi-note>` blocks. See README.md.
 *
 * Static notes ride the system prompt; volatile ones ride a hidden message after each
 * user turn, so a change costs only the tail of the context rather than all of it.
 */

import { type ExtensionAPI, getShellConfig } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";

/** `customType` on the grounding message. pi uses it to pick a renderer; it never reaches the model. */
export const NOTE_TYPE = "pi-plate-note";

// `pi`, not `pi-plate`: the system prompt already establishes pi as a referent.
const NOTE_OPEN = "<pi-note>";
const NOTE_CLOSE = "</pi-note>";

/** Wrap one fact in a block. One fact per block, so blocks can be omitted independently. */
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

// Product names, which carry denser associations with a userland than `darwin` does.
// The kernel name stays in parentheses so the note reconciles with `uname -s`.
const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS (Darwin)",
  linux: "Linux",
  win32: "Windows",
};

/** Platform and architecture. */
export function buildEnvironmentNote(): string {
  const name = platform();
  return `Environment: ${PLATFORM_NAMES[name] ?? name} ${arch()}`;
}

// Directive first: the model writes execution plans, so a rule of action lands in the
// register it is already thinking in.
export function buildBashNote(shell: string, root: string): string {
  return (
    "Run multi-step shell work as a single command chained with &&. Each bash call " +
    `starts a new ${shell} in ${root}; cd, export, and shell variables do not carry ` +
    "between calls."
  );
}

/** The static block, built once per session so the string stays byte-identical. */
export function buildStaticNotes(root: string, withBash: boolean): string {
  const notes = [PROVENANCE_NOTE, buildEnvironmentNote()];
  if (withBash) {
    notes.push(buildBashNote(getShellConfig().shell, root));
  }
  return notes.map(wrapNote).join("\n");
}

// =============================================================================
// Time note
// =============================================================================

/**
 * Local and UTC together. Local carries weekday, offset and zone; UTC compares directly
 * against the timestamps in logs and CI output, so neither has to be converted.
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
 * Parse `git status --porcelain=v2 --branch`. One command carries everything the note
 * needs, so it either all succeeds or nothing is emitted -- no partial read can report
 * "clean" because a second command failed.
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
 * Git state for `dir`, or undefined when it is not a work tree, git is missing, or the
 * command times out. Undefined is the point: a note that guesses "clean" is worse than
 * no note, because the model is told to trust it.
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

/** Checked before a scan, so a missing git costs one spawn rather than one per child. */
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
 * Repos at `cwd`, or in its immediate children when `cwd` is in no repo itself --
 * starting pi in a directory of checkouts is common.
 *
 * Children are filtered on a `.git` entry before git is spawned, since a stat costs
 * microseconds and a spawn milliseconds. `.git` is a file in worktrees and submodules,
 * so this tests existence rather than type.
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

  // Both divergences read against one upstream, so they are joined before it is named.
  const divergence: string[] = [];
  if (state.ahead > 0) divergence.push(`${state.ahead} ahead`);
  if (state.behind > 0) divergence.push(`${state.behind} behind`);
  if (state.upstream && divergence.length > 0) {
    parts.push(`${divergence.join(", ")} of ${state.upstream}`);
  }

  return parts.join(", ");
}

/**
 * The repos as one note, or undefined when there are none. Every repo is listed, since
 * nothing here ranks them. The parent path is restated because this note can sit far
 * from pi's own working-directory line.
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
}
