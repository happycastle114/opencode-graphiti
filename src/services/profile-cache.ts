import { homedir } from "node:os";
import { join } from "node:path";
import { createAtomicJsonStore } from "./atomic-json-store.js";

type CachedProfile = {
  readonly content: string;
  readonly updatedAt: string;
};

type ProfileCacheData = Record<string, readonly CachedProfile[]>;

export type ProfileCache = {
  readonly save: (groupId: string, content: string) => Promise<void>;
  readonly read: (groupId: string) => readonly string[];
};

const DEFAULT_PATH = join(homedir(), ".config", "opencode", "graphiti-profile.json");

export function createProfileCache(filePath = DEFAULT_PATH): ProfileCache {
  const store = createAtomicJsonStore<ProfileCacheData>(filePath);

  return {
    async save(groupId, content): Promise<void> {
      const current = store.read() ?? {};
      const entries = current[groupId] ?? [];
      const nextEntries = [
        ...entries.filter((entry) => entry.content !== content),
        { content, updatedAt: new Date().toISOString() },
      ].slice(-20);
      await store.write({ ...current, [groupId]: nextEntries });
    },
    read(groupId): readonly string[] {
      return (store.read()?.[groupId] ?? []).map((entry) => entry.content);
    },
  };
}

export const profileCache = createProfileCache();
