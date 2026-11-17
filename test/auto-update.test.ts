import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkForUpdates } from "../scripts/auto-update.js";

// Real git repositories: an "online" bare repo, the author's copy, and the user's copy.
let root: string;
let origin: string;
let author: string;
let user: string;
const BRANCH = "work";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe" }).toString().trim();

function commit(dir: string, file: string, content: string, msg: string) {
  writeFileSync(path.join(dir, file), content);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", msg);
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "safetab-autoupdate-"));
  origin = path.join(root, "origin.git");
  author = path.join(root, "author");
  user = path.join(root, "user");
  git(root, "init", "-q", "--bare", origin);
  git(root, "clone", "-q", origin, author);
  commit(author, "app.txt", "v1\n", "v1");
  git(author, "push", "-q", "origin", `HEAD:refs/heads/main`);
  git(author, "push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`);
  git(root, "clone", "-q", "--branch", "main", origin, user);
  writeFileSync(path.join(user, ".env"), "SECRET=keep-me\n"); // untracked, must never be touched
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("auto-update", () => {
  it("does nothing when already up to date", async () => {
    const r = await checkForUpdates(user, "origin", BRANCH);
    expect(r).toMatchObject({ updated: false, reason: "already up to date" });
  });

  it("fast-forwards to new work and reports changed files, leaving .env alone", async () => {
    commit(author, "app.txt", "v2\n", "v2");
    commit(author, "new.txt", "hello\n", "add file");
    git(author, "push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`);
    const r = await checkForUpdates(user, "origin", BRANCH);
    expect(r.updated).toBe(true);
    expect(r.changedFiles.sort()).toEqual(["app.txt", "new.txt"]);
    expect(readFileSync(path.join(user, "app.txt"), "utf8")).toBe("v2\n");
    expect(readFileSync(path.join(user, ".env"), "utf8")).toBe("SECRET=keep-me\n");
  });

  it("never overwrites local edits to tracked files", async () => {
    writeFileSync(path.join(user, "app.txt"), "my local edit\n");
    commit(author, "app.txt", "v3\n", "v3");
    git(author, "push", "-q", "origin", `HEAD:refs/heads/${BRANCH}`);
    const r = await checkForUpdates(user, "origin", BRANCH);
    expect(r.updated).toBe(false);
    expect(r.reason).toMatch(/local edits/);
    expect(readFileSync(path.join(user, "app.txt"), "utf8")).toBe("my local edit\n");
    git(user, "checkout", "--", "app.txt");
  });

  it("refuses to update when the histories have diverged (no merges, no data loss)", async () => {
    commit(user, "mine.txt", "local commit\n", "local work");
    const r = await checkForUpdates(user, "origin", BRANCH);
    expect(r.updated).toBe(false);
    expect(r.reason).toMatch(/not a straight continuation/);
    expect(readFileSync(path.join(user, "mine.txt"), "utf8")).toBe("local commit\n");
  });
});
