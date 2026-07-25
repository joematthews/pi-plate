/**
 * Print the notes pi-plate would inject, and what triggers each one.
 *
 *   npx tsx debug.ts [root]
 *
 * `root` defaults to the current working directory.
 */
import {
  bashEnabled,
  buildBashStateNotice,
  buildGitNote,
  buildStaticNotes,
  buildTimeNote,
  mutatesShellState,
  wrapNote,
} from "./index.ts";

const root = process.argv[2] ?? process.cwd();

console.log("=== system prompt (once per session) ===");
console.log("trigger: always; the bash block also requires the bash tool\n");
console.log(buildStaticNotes(root, bashEnabled(undefined)));

console.log("\n\n=== system prompt with bash disabled ===");
console.log(buildStaticNotes(root, false));

console.log("\n\n=== hidden message (after each user prompt) ===");
console.log("trigger: time always; git only in a repo, and only when it changed\n");
const git = buildGitNote(root);
console.log(wrapNote(buildTimeNote()));
console.log(git ? wrapNote(git) : "(no git note -- nothing here is a repo)");

console.log("\n\n=== bash result notice (per command) ===");
console.log("trigger: the command changed shell state\n");
for (const command of ["cd src", "export FOO=bar", "npm ci && cd dist", "ls", "FOO=bar make"]) {
  const fires = mutatesShellState(command);
  console.log(`[${fires ? "NOTE" : "skip"}] ${command}`);
  if (fires) {
    console.log(wrapNote(buildBashStateNotice(root)));
  }
}
