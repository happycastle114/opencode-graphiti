import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { basename } from "node:path";
import { GROUP_ID_PREFIX, GROUP_SCHEME, USER_GROUP_ID } from "../config.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function getGitEmail(): string | null {
  try {
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    return email || null;
  } catch {
    return null;
  }
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * git remote (or owner/repo) -> host/owner/repo, lowercase.
 * Must match memory_hub/scope.py (k3s-happycastle) and memctl
 * (graphiti-memory-plugins); tests/slug-vectors.json pins the cases.
 */
export function remoteKey(remote: string): string {
  let s = remote.trim();
  if (s.includes("://")) {
    s = s.split("://", 2)[1] ?? "";
    const i = s.indexOf("/");
    let host = i >= 0 ? s.slice(0, i) : s;
    const path = i >= 0 ? s.slice(i + 1) : "";
    host = host.slice(host.lastIndexOf("@") + 1).split(":", 1)[0] ?? host;
    s = `${host}/${path}`;
  } else {
    const m = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
    if (m) s = `${m[1]}/${m[2]}`;
  }
  s = s.replace(/^\/+|\/+$/g, "");
  if (s.endsWith(".git")) s = s.slice(0, -4);
  s = s.replace(/^\/+|\/+$/g, "").toLowerCase();
  if ((s.match(/\//g) ?? []).length === 1) s = `github.com/${s}`;
  return s;
}

export function projectGroupForRemote(remote: string): string {
  let key = remoteKey(remote);
  if (key.startsWith("github.com/")) key = key.slice("github.com/".length);
  return `project-${slug(key)}`;
}

function git(directory: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", directory, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

export function getScopedProjectTag(directory: string): string {
  const override = (process.env.MEMORY_PROJECT ?? "").trim();
  if (override) return override.startsWith("project-") ? override : projectGroupForRemote(override);
  const remote = git(directory, ["remote", "get-url", "origin"]);
  if (remote) return projectGroupForRemote(remote);
  const top = git(directory, ["rev-parse", "--show-toplevel"]) || directory;
  return `project-local-${slug(basename(top.replace(/\/+$/, ""))) || "root"}`;
}

export function getUserTag(): string {
  if (USER_GROUP_ID) return USER_GROUP_ID;
  if (GROUP_SCHEME === "scoped") return "user";
  const email = getGitEmail();
  if (email) {
    return `${GROUP_ID_PREFIX}_user_${sha256(email)}`;
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return `${GROUP_ID_PREFIX}_user_${sha256(fallback)}`;
}

export function getProjectTag(directory: string): string {
  if (GROUP_SCHEME === "scoped") return getScopedProjectTag(directory);
  return `${GROUP_ID_PREFIX}_project_${sha256(directory)}`;
}

export function getTags(directory: string): { user: string; project: string } {
  return {
    user: getUserTag(),
    project: getProjectTag(directory),
  };
}

/** Source tool goes in episode metadata, never in the group id. */
export function sourceDescription(type: string | undefined): string {
  const base = type || "opencode-memory";
  return GROUP_SCHEME === "scoped" && !base.startsWith("opencode") ? `opencode ${base}` : base;
}
