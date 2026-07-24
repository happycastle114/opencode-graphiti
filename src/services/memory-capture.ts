import type { EpisodeSource, MemoryType } from "../types/index.js";
import { extractExplicitProfileMemory } from "./memory-enhancement.js";

export interface MemoryWriter {
  addMemory(
    content: string,
    groupId: string,
    metadata?: {
      type?: MemoryType;
      name?: string;
      source?: EpisodeSource;
      [key: string]: unknown;
    },
  ): Promise<{ success: boolean }>;
}

export interface MemoryGroups {
  user: string;
  project: string;
}

export interface SessionDigestSaver {
  save(sessionId: string, digest: string | null): Promise<boolean>;
  forget(sessionId: string): void;
}

export async function saveExplicitProfileMemory(
  writer: MemoryWriter,
  groups: MemoryGroups,
  userText: string,
  turnId: string,
): Promise<boolean> {
  const profileMemory = extractExplicitProfileMemory(userText);
  if (!profileMemory) return false;

  const result = await writer.addMemory(profileMemory.content, groups.user, {
    type: profileMemory.type,
    name: `profile-${turnId}`,
    source: "message",
  });
  return result.success;
}

export async function saveSessionDigestMemory(
  writer: MemoryWriter,
  groups: MemoryGroups,
  sessionId: string,
  digest: string | null,
): Promise<boolean> {
  if (!digest) return false;

  const result = await writer.addMemory(digest, groups.project, {
    type: "conversation",
    name: `session-digest-${sessionId}`,
    source: "message",
  });
  return result.success;
}

export function createSessionDigestSaver(writer: MemoryWriter, groups: MemoryGroups): SessionDigestSaver {
  const savedDigests = new Map<string, string>();
  const writeChains = new Map<string, Promise<boolean>>();

  return {
    async save(sessionId: string, digest: string | null): Promise<boolean> {
      if (!digest || savedDigests.get(sessionId) === digest) return false;

      const writeDigest = async (): Promise<boolean> => {
        if (savedDigests.get(sessionId) === digest) return false;
        const saved = await saveSessionDigestMemory(writer, groups, sessionId, digest);
        if (saved) savedDigests.set(sessionId, digest);
        return saved;
      };
      const previousWrite = writeChains.get(sessionId);
      const write = previousWrite
        ? previousWrite.catch(() => false).then(writeDigest)
        : writeDigest();
      writeChains.set(sessionId, write);

      try {
        return await write;
      } finally {
        if (writeChains.get(sessionId) === write) writeChains.delete(sessionId);
      }
    },
    forget(sessionId: string): void {
      savedDigests.delete(sessionId);
    },
  };
}

export function createSessionDigestRefresher(saver: SessionDigestSaver) {
  const generations = new Map<string, number>();

  return {
    async refresh(sessionId: string, loadDigest: () => Promise<string | null>): Promise<boolean> {
      const generation = (generations.get(sessionId) ?? 0) + 1;
      generations.set(sessionId, generation);

      const digest = await loadDigest();
      if (generations.get(sessionId) !== generation) return false;
      return saver.save(sessionId, digest);
    },
    forget(sessionId: string): void {
      generations.delete(sessionId);
      saver.forget(sessionId);
    },
  };
}
