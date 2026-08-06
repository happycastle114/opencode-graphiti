import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getText, type MessageLike } from "./message-parts.js";
import { isFullyPrivate, stripPrivateContent } from "./privacy.js";
import { sanitizeTextForStorage } from "./storage-sanitizer.js";

const DEFAULT_REPLAY_DIRECTORY = join(homedir(), ".opencode-graphiti", "replays");
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type ReplayMessage = MessageLike;

export interface ReplayEvent {
  id: string;
  role: "user" | "assistant" | "system";
  at: string;
  content: string;
}

export interface ReplayTimeline {
  sessionId: string;
  events: ReplayEvent[];
}

export interface ReplaySummary {
  sessionId: string;
  updatedAt: string;
  eventCount: number;
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error("Invalid replay session id");
  }
}

function toIsoTimestamp(value: number | string | undefined): string {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function replayPath(sessionId: string, directory: string): string {
  validateSessionId(sessionId);
  return join(directory, `${sessionId}.json`);
}

export function buildReplayTimeline(sessionId: string, messages: ReplayMessage[]): ReplayTimeline {
  validateSessionId(sessionId);

  const events = messages.flatMap((message, index): ReplayEvent[] => {
    const role = message.info?.role;
    if (role !== "user" && role !== "assistant" && role !== "system") return [];

    const rawContent = sanitizeTextForStorage(getText(message.parts));
    if (!rawContent || isFullyPrivate(rawContent)) return [];

    const content = stripPrivateContent(rawContent).trim();
    if (!content) return [];

    return [{
      id: message.info?.id ?? `${sessionId}-${index}`,
      role,
      at: toIsoTimestamp(message.info?.time?.created),
      content,
    }];
  });

  return {
    sessionId,
    events: events.sort((left, right) => left.at.localeCompare(right.at)),
  };
}

export function saveReplayTimeline(
  timeline: ReplayTimeline,
  directory = DEFAULT_REPLAY_DIRECTORY,
): void {
  validateSessionId(timeline.sessionId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const target = replayPath(timeline.sessionId, directory);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(timeline), { encoding: "utf-8", mode: 0o600 });
  renameSync(temporary, target);
}

export function loadReplayTimeline(
  sessionId: string,
  directory = DEFAULT_REPLAY_DIRECTORY,
): ReplayTimeline | null {
  const path = replayPath(sessionId, directory);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ReplayTimeline;
    if (parsed.sessionId !== sessionId || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function listReplaySummaries(directory = DEFAULT_REPLAY_DIRECTORY): ReplaySummary[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .flatMap((entry): ReplaySummary[] => {
      const sessionId = entry.slice(0, -".json".length);
      try {
        const timeline = loadReplayTimeline(sessionId, directory);
        if (!timeline) return [];
        const lastEvent = timeline.events[timeline.events.length - 1];
        return [{
          sessionId,
          updatedAt: lastEvent?.at ?? new Date(0).toISOString(),
          eventCount: timeline.events.length,
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
