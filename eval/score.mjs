/**
 * Score one evaluation run: read the playground the model built and the session it
 * produced, and emit a JSON verdict on stdout.
 *
 *   node score.mjs <id> <variant> <arm> <playgroundDir> <sessionDir> <exitCode> <seconds>
 *
 * Filesystem checks are ground truth -- what the model claims in prose is ignored.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [, , id, variant, arm, play, sessionDir, exitCode, seconds] = process.argv;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};
const readText = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Filesystem ground truth
// ---------------------------------------------------------------------------

const apiPkg = readJson(join(play, "api", "package.json"));
const webPkg = readJson(join(play, "web", "package.json"));
const readme = readText(join(play, "api", "README.md"));

const deps = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });
const apiDeps = deps(apiPkg);
const webDeps = deps(webPkg);

// The version npm actually resolved, read from the installed package itself.
const installedDedent = readJson(
  join(play, "api", "node_modules", "dedent", "package.json"),
)?.version;

const fs = {
  apiPkgExists: !!apiPkg,
  webPkgExists: !!webPkg,
  dedentInApi: "dedent" in apiDeps,
  msInWeb: "ms" in webDeps,
  // Crossed wires: the signature of losing track of which subdirectory you are in.
  msInApi: "ms" in apiDeps,
  dedentInWeb: "dedent" in webDeps,
  apiNodeModules: existsSync(join(play, "api", "node_modules")),
  webNodeModules: existsSync(join(play, "web", "node_modules")),
  // The signature of a lost `cd`: work landing at the playground root.
  strayPkgAtRoot: existsSync(join(play, "package.json")),
  strayNodeModulesAtRoot: existsSync(join(play, "node_modules")),
  readmeInApi: readme !== undefined,
  readmeAtRoot: existsSync(join(play, "README.md")),
  installedDedent: installedDedent ?? null,
};

// Did the README quote the version npm actually installed, or invent one?
const versionsInReadme = readme ? [...readme.matchAll(/\d+\.\d+\.\d+/g)].map((m) => m[0]) : [];
fs.readmeVersionCorrect = !!installedDedent && versionsInReadme.includes(installedDedent);
fs.readmeVersions = versionsInReadme;

// Variant B only: the copyright year, never named in the prompt.
const years = readme ? [...readme.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])) : [];
fs.readmeYears = years;
fs.readmeYearCurrent = years.includes(new Date().getFullYear());

const taskPassed =
  fs.apiPkgExists &&
  fs.webPkgExists &&
  fs.dedentInApi &&
  fs.msInWeb &&
  !fs.msInApi &&
  !fs.dedentInWeb &&
  fs.apiNodeModules &&
  fs.webNodeModules &&
  !fs.strayPkgAtRoot &&
  !fs.strayNodeModulesAtRoot &&
  fs.readmeInApi;

// ---------------------------------------------------------------------------
// Session trace
// ---------------------------------------------------------------------------

const sessionFile = (() => {
  if (!existsSync(sessionDir)) return undefined;
  const found = readdirSync(sessionDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(sessionDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0];
})();

const trace = {
  notes: [],
  bashCommands: [],
  thinking: [],
  bashNoteSeen: 0,
  assistantText: "",
};

if (sessionFile) {
  for (const line of readFileSync(sessionFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "custom_message") {
      trace.notes.push(entry.content);
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    const content = message.content;
    if (message.role === "toolResult") {
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "text" && block.text?.includes("<pi-note>")) trace.bashNoteSeen++;
      }
      continue;
    }
    if (message.role !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "thinking") trace.thinking.push(block.thinking ?? "");
      if (block.type === "text") trace.assistantText += `${block.text ?? ""}\n`;
      if (block.type === "toolCall" && block.name === "bash") {
        trace.bashCommands.push(String(block.arguments?.command ?? ""));
      }
    }
  }
}

const thinkingText = trace.thinking.join("\n");

// ---------------------------------------------------------------------------
// Salience: does grounding show up in the model's reasoning at all?
// ---------------------------------------------------------------------------

const mentions = (re) => (thinkingText.match(re) ?? []).length;

const salience = {
  piNoteTag: mentions(/pi-note/gi),
  // Attributing a harness fact to the human -- the artifact we most want absent.
  attributedToUser: mentions(/\b(the user|you) (said|told|mentioned|specified|provided)\b/gi),
  timeOrDate: mentions(/\b(today'?s date|current time|timezone|time zone|CDT|CST)\b/gi),
  environment: mentions(/\b(darwin|arm64|en-US|America region|\/bin\/zsh)\b/gi),
  shellPersistence: mentions(
    /\b(fresh shell|does not persist|doesn'?t persist|shell (state|exits|has exited)|carry across calls)\b/gi,
  ),
};
salience.total = Object.values(salience).reduce((a, b) => a + b, 0);

process.stdout.write(
  `${JSON.stringify(
    {
      id,
      variant,
      arm,
      exitCode: Number(exitCode),
      seconds: Number(seconds),
      taskPassed,
      fs,
      bashCallCount: trace.bashCommands.length,
      bashCommands: trace.bashCommands,
      groundingNotes: trace.notes,
      bashNoteSeen: trace.bashNoteSeen,
      salience,
      thinking: trace.thinking,
      assistantText: trace.assistantText.trim(),
    },
    null,
    2,
  )}\n`,
);
