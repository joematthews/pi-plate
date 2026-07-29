/**
 * Print the notes pi-plate would inject, and what triggers each one.
 *
 *   npx tsx debug.ts [root]
 *
 * `root` defaults to the current working directory.
 */
import { bashEnabled, buildGitNote, buildStaticNotes, buildTimeNote, wrapNote } from "./index.ts";

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
