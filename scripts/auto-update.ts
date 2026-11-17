import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface UpdateResult {
  updated: boolean;
  /** Why nothing changed, or what changed. */
  reason: string;
  changedFiles: string[];
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await run("git", args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Fetches `branch` from `remote` and fast-forwards the current checkout to it.
 * Safe by design: never merges, rebases or overwrites. It skips the update when tracked
 * files have local edits, or when the remote history isn't a straight continuation of
 * the local one. Untracked/ignored files such as .env are never touched.
 */
export async function checkForUpdates(cwd: string, remote: string, branch: string): Promise<UpdateResult> {
  const dirty = await git(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) return { updated: false, reason: "local edits to tracked files; not updating", changedFiles: [] };

  await git(cwd, ["fetch", "--quiet", remote, branch]);
  const head = await git(cwd, ["rev-parse", "HEAD"]);
  const incoming = await git(cwd, ["rev-parse", "FETCH_HEAD"]);
  if (head === incoming) return { updated: false, reason: "already up to date", changedFiles: [] };

  try {
    await git(cwd, ["merge-base", "--is-ancestor", head, incoming]);
  } catch {
    return { updated: false, reason: "update is not a straight continuation of your copy; not updating", changedFiles: [] };
  }

  const changed = (await git(cwd, ["diff", "--name-only", head, incoming])).split("\n").filter(Boolean);
  await git(cwd, ["merge", "--ff-only", "--quiet", incoming]);
  return { updated: true, reason: `updated to ${incoming.slice(0, 7)}`, changedFiles: changed };
}
