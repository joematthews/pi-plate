import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import piPlate, {
  bashEnabled,
  buildBashNote,
  buildBashStateNotice,
  buildEnvironmentNote,
  buildGitNote,
  buildStaticNotes,
  buildTimeNote,
  describeRepo,
  formatGitNote,
  type GitState,
  isNotable,
  MAX_DETAILED_REPOS,
  mutatesShellState,
  NOTE_TYPE,
  parseGitStatus,
  PROVENANCE_NOTE,
  readGitState,
  type RepoState,
  wrapNote,
} from "./index.ts";

const repo = (name: string | undefined, state: Partial<GitState>): RepoState => ({
  ...(name === undefined ? {} : { name }),
  state: { dirtyCount: 0, ahead: 0, behind: 0, branch: "main", head: "9b3a2059", ...state },
});

// =============================================================================
// Note format
// =============================================================================

describe("wrapNote", () => {
  it("wraps one fact per block", () => {
    expect(wrapNote("a fact")).toBe("<pi-note>\na fact\n</pi-note>");
  });

  it("uses a tag anchored to pi, not to the extension", () => {
    // The model is told it runs inside pi; it has never heard of pi-plate.
    expect(wrapNote("x")).not.toContain("pi-plate");
  });
});

// =============================================================================
// Static notes
// =============================================================================

describe("bashEnabled", () => {
  it("is true when pi falls back to its default tool list", () => {
    expect(bashEnabled(undefined)).toBe(true);
  });

  it("follows an explicit tool list in both directions", () => {
    expect(bashEnabled(["read", "bash"])).toBe(true);
    expect(bashEnabled(["read", "edit"])).toBe(false);
    expect(bashEnabled([])).toBe(false);
  });
});

describe("buildEnvironmentNote", () => {
  it("reports platform and arch", () => {
    expect(buildEnvironmentNote()).toMatch(/^Environment: \w+ \w+$/);
  });

  it("omits locale and region, which the time note already carries", () => {
    expect(buildEnvironmentNote()).not.toMatch(/en-US|America|region/);
  });
});

describe("buildBashNote", () => {
  it("leads with the directive, then explains", () => {
    const note = buildBashNote("/bin/bash", "/repo");
    expect(note.indexOf("chained with &&")).toBeLessThan(note.indexOf("do not carry"));
  });

  it("names the shell pi actually uses and the directory calls start in", () => {
    expect(buildBashNote("/bin/bash", "/repo")).toContain("new /bin/bash in /repo");
  });
});

describe("buildStaticNotes", () => {
  it("always states provenance and environment", () => {
    const notes = buildStaticNotes("/repo", false);
    expect(notes).toContain(PROVENANCE_NOTE);
    expect(notes).toContain("Environment: ");
  });

  it("omits the bash note when the bash tool is disabled", () => {
    expect(buildStaticNotes("/repo", false)).not.toContain("chained with &&");
    expect(buildStaticNotes("/repo", true)).toContain("chained with &&");
  });

  it("emits one block per fact", () => {
    // Count delimiters on their own line: the provenance note names the tag in its
    // own body, so a bare substring match would over-count.
    expect(buildStaticNotes("/repo", true).match(/^<pi-note>$/gm)).toHaveLength(3);
    expect(buildStaticNotes("/repo", false).match(/^<pi-note>$/gm)).toHaveLength(2);
  });
});

// =============================================================================
// Bash state notice
// =============================================================================

describe("buildBashStateNotice", () => {
  it("reports the transition rather than re-teaching the rule", () => {
    const notice = buildBashStateNotice("/repo");
    expect(notice).toContain("has exited");
    expect(notice).toContain("/repo");
    // The static note carries the directive; repeating it here would be the bloat
    // that made the old per-call note expensive.
    expect(notice).not.toContain("chained with &&");
  });
});

describe("mutatesShellState", () => {
  it("is true for directory and env changes the next call might depend on", () => {
    for (const command of ["cd src", "export FOO=bar", "source .env", ". .env", "FOO=bar"]) {
      expect(mutatesShellState(command), command).toBe(true);
    }
  });

  it("is false for stateless commands", () => {
    for (const command of ["ls", "npm test", "git status", "rg cd src"]) {
      expect(mutatesShellState(command), command).toBe(false);
    }
  });

  it("finds a state change in any segment of a compound command", () => {
    expect(mutatesShellState("npm ci && cd dist")).toBe(true);
  });

  it("ignores a transient VAR=value prefix that scopes to one command", () => {
    expect(mutatesShellState("FOO=bar make")).toBe(false);
  });

  it("does not treat a cd inside a subshell as persistent", () => {
    expect(mutatesShellState("(cd src && ls)")).toBe(false);
  });
});

// =============================================================================
// Time note
// =============================================================================

describe("buildTimeNote", () => {
  const instant = new Date("2026-07-25T20:18:21.293Z");

  it("carries both local and UTC so the model never converts", () => {
    const note = buildTimeNote(instant);
    expect(note).toContain("Local: ");
    expect(note).toContain(`UTC: ${instant.toISOString()}`);
  });

  it("uses JavaScript's own rendering for the local side", () => {
    expect(buildTimeNote(instant)).toContain(instant.toString());
  });
});

// =============================================================================
// Git state
// =============================================================================

describe("parseGitStatus", () => {
  it("reads a clean checked-out branch", () => {
    expect(parseGitStatus("# branch.oid a2198a99012d05c3\n# branch.head main\n")).toEqual({
      branch: "main",
      head: "a2198a99",
      dirtyCount: 0,
      ahead: 0,
      behind: 0,
    });
  });

  it("counts every changed entry, including untracked", () => {
    const state = parseGitStatus(
      "# branch.oid a2198a99012d05c3\n# branch.head main\n1 .M N... a.txt\n? b.txt\n? c.txt\n",
    );
    expect(state.dirtyCount).toBe(3);
  });

  it("reads an unborn branch as having no commits", () => {
    expect(parseGitStatus("# branch.oid (initial)\n# branch.head main\n").head).toBeUndefined();
  });

  it("reads a detached HEAD as having no branch", () => {
    const state = parseGitStatus("# branch.oid a2198a99012d05c3\n# branch.head (detached)\n");
    expect(state.branch).toBeUndefined();
    expect(state.head).toBe("a2198a99");
  });

  it("reads upstream drift as positive ahead/behind counts", () => {
    const state = parseGitStatus(
      "# branch.oid a219\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n",
    );
    expect(state).toMatchObject({ upstream: "origin/main", ahead: 2, behind: 1 });
  });
});

describe("readGitState", () => {
  it("is undefined outside a work tree rather than guessing", () => {
    expect(readGitState("/")).toBeUndefined();
  });
});

describe("isNotable", () => {
  const base: GitState = { branch: "main", head: "abc", dirtyCount: 0, ahead: 0, behind: 0 };

  it("is false only for a clean, synced, committed repo", () => {
    expect(isNotable(base)).toBe(false);
  });

  it("is true for uncommitted work, drift, or an unborn branch", () => {
    expect(isNotable({ ...base, dirtyCount: 1 })).toBe(true);
    expect(isNotable({ ...base, ahead: 1 })).toBe(true);
    expect(isNotable({ ...base, behind: 1 })).toBe(true);
    expect(isNotable({ ...base, head: undefined })).toBe(true);
  });
});

describe("describeRepo", () => {
  const base: GitState = { branch: "main", head: "9b3a2059", dirtyCount: 0, ahead: 0, behind: 0 };

  it("describes a clean checked-out branch", () => {
    expect(describeRepo(base)).toBe("branch main, at 9b3a2059, clean");
  });

  it("reports an unborn branch and uncommitted changes", () => {
    expect(describeRepo({ ...base, head: undefined, dirtyCount: 16 })).toBe(
      "branch main, no commits yet, 16 uncommitted changes",
    );
  });

  it("reports a detached HEAD", () => {
    expect(describeRepo({ ...base, branch: undefined })).toBe("detached HEAD, at 9b3a2059, clean");
  });

  it("shows ahead/behind only when there is drift against an upstream", () => {
    expect(describeRepo({ ...base, upstream: "origin/main" })).toBe(
      "branch main, at 9b3a2059, clean",
    );
    expect(describeRepo({ ...base, upstream: "origin/main", ahead: 2 })).toBe(
      "branch main, at 9b3a2059, clean, 2 ahead of origin/main",
    );
  });
});

describe("formatGitNote", () => {
  it("is undefined when nothing there is a repo", () => {
    expect(formatGitNote([])).toBeUndefined();
  });

  it("describes a single repo at the working directory without naming it", () => {
    expect(formatGitNote([repo(undefined, {})])).toBe("Git: branch main, at 9b3a2059, clean");
  });

  it("names each repo when several sit side by side", () => {
    const note = formatGitNote([
      repo("api", { dirtyCount: 2 }),
      repo("web", { behind: 1, upstream: "origin/dev" }),
    ]);
    expect(note).toContain("2 repos here.");
    expect(note).toContain("api: branch main, at 9b3a2059, 2 uncommitted changes.");
    expect(note).toContain("web: branch main, at 9b3a2059, clean, 1 behind of origin/dev.");
  });

  it("counts clean repos instead of listing them", () => {
    const note = formatGitNote([repo("api", { dirtyCount: 1 }), repo("web", {}), repo("docs", {})]);
    expect(note).toBe(
      "Git: 3 repos here. api: branch main, at 9b3a2059, 1 uncommitted changes. 2 others clean.",
    );
  });

  it("caps the described repos so the note cannot grow without bound", () => {
    const many = Array.from({ length: MAX_DETAILED_REPOS + 3 }, (_, i) =>
      repo(`r${i}`, { dirtyCount: 1 }),
    );
    const note = formatGitNote(many) ?? "";
    expect(note.match(/uncommitted/g)).toHaveLength(MAX_DETAILED_REPOS);
    expect(note).toContain("3 others.");
  });
});

describe("buildGitNote", () => {
  it("is undefined outside any repo", () => {
    expect(buildGitNote("/")).toBeUndefined();
  });

  it("describes this repo when run inside it", () => {
    expect(buildGitNote(process.cwd())).toMatch(/^Git: branch /);
  });
});

// =============================================================================
// Extension wiring
// =============================================================================

type Handler = (event: never, ctx: never) => unknown;

function register(cwd = process.cwd()): { handlers: Map<string, Handler>; ctx: { cwd: string } } {
  const handlers = new Map<string, Handler>();
  const pi = { on: (event: string, handler: Handler) => handlers.set(event, handler) };
  piPlate(pi as unknown as ExtensionAPI);
  return { handlers, ctx: { cwd } };
}

const call = <T>(handlers: Map<string, Handler>, event: string, payload: unknown, ctx: unknown) =>
  handlers.get(event)!(payload as never, ctx as never) as T;

interface StartResult {
  systemPrompt: string;
  message: { customType: string; content: string; display: boolean };
}

const startEvent = (selectedTools?: string[]) => ({
  systemPrompt: "BASE PROMPT",
  systemPromptOptions: selectedTools ? { selectedTools } : {},
});

describe("before_agent_start", () => {
  let harness: ReturnType<typeof register>;

  beforeEach(() => {
    harness = register();
  });

  it("appends the static notes to the base prompt rather than replacing it", () => {
    const result = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    expect(result.systemPrompt.startsWith("BASE PROMPT")).toBe(true);
    expect(result.systemPrompt).toContain(PROVENANCE_NOTE);
  });

  it("returns a byte-identical system prompt on every turn", () => {
    // Drift here would change position 0 and invalidate the whole KV cache.
    const first = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    const second = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it("omits the bash note from the prompt when bash is disabled", () => {
    const noBash = register();
    const result = call<StartResult>(
      noBash.handlers,
      "before_agent_start",
      startEvent(["read", "edit"]),
      noBash.ctx,
    );
    expect(result.systemPrompt).not.toContain("chained with &&");
  });

  it("returns a hidden message so the TUI stays clean", () => {
    const result = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    expect(result.message.display).toBe(false);
    expect(result.message.customType).toBe(NOTE_TYPE);
    expect(result.message.content).toContain("Current Time: ");
  });

  it("states git once, then stays quiet until it changes", () => {
    const first = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    const second = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    expect(first.message.content).toContain("Git: ");
    expect(second.message.content).not.toContain("Git: ");
  });

  it("omits git entirely outside a repo", () => {
    const outside = register("/");
    const result = call<StartResult>(
      outside.handlers,
      "before_agent_start",
      startEvent(),
      outside.ctx,
    );
    expect(result.message.content).not.toContain("Git: ");
    expect(result.message.content).toContain("Current Time: ");
  });

  it("re-states git after a new session starts", () => {
    call(harness.handlers, "before_agent_start", startEvent(), harness.ctx);
    call(harness.handlers, "session_start", {}, harness.ctx);
    const afterReset = call<StartResult>(
      harness.handlers,
      "before_agent_start",
      startEvent(),
      harness.ctx,
    );
    expect(afterReset.message.content).toContain("Git: ");
  });
});

describe("tool_result", () => {
  let harness: ReturnType<typeof register>;

  const bashResult = (command: unknown, overrides: Record<string, unknown> = {}) => ({
    toolName: "bash",
    toolCallId: "call_1",
    input: { command },
    content: [{ type: "text", text: "output" }],
    isError: false,
    details: { truncation: { truncated: true } },
    usage: { input: 1, output: 2 },
    ...overrides,
  });

  beforeEach(() => {
    harness = register();
  });

  it("appends the notice after a state-mutating command", () => {
    const result = call<{ content: { type: string; text: string }[] }>(
      harness.handlers,
      "tool_result",
      bashResult("cd src"),
      harness.ctx,
    );
    const [output, notice] = result.content;
    expect(result.content).toHaveLength(2);
    expect(output?.text).toBe("output");
    expect(notice?.text).toContain("<pi-note>");
    expect(notice?.text).toContain(harness.ctx.cwd);
  });

  it("stays silent after a stateless command", () => {
    expect(call(harness.handlers, "tool_result", bashResult("ls"), harness.ctx)).toBeUndefined();
  });

  it("keeps the notice when the command cannot be read (fail open)", () => {
    const result = call<{ content: unknown[] }>(
      harness.handlers,
      "tool_result",
      bashResult(undefined),
      harness.ctx,
    );
    expect(result.content).toHaveLength(2);
  });

  it("ignores tools other than bash", () => {
    const result = call(
      harness.handlers,
      "tool_result",
      bashResult("cd src", { toolName: "read" }),
      harness.ctx,
    );
    expect(result).toBeUndefined();
  });

  it("passes details, isError, and usage through untouched", () => {
    // pi reads these from the returned result verbatim, so dropping them would
    // discard the bash tool's truncation metadata.
    const event = bashResult("cd src", { isError: true });
    const result = call<Record<string, unknown>>(
      harness.handlers,
      "tool_result",
      event,
      harness.ctx,
    );
    expect(result.details).toBe(event.details);
    expect(result.usage).toBe(event.usage);
    expect(result.isError).toBe(true);
  });

  it("does not mutate the original result content", () => {
    const event = bashResult("cd src");
    call(harness.handlers, "tool_result", event, harness.ctx);
    expect(event.content).toHaveLength(1);
  });
});
