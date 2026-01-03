import { CONFIG } from "../config.js";
import type { UserProfile, MemoryResult } from "../types/index.js";

interface ProfileResponse {
  profile?: UserProfile;
}

interface MemoriesResponseMinimal {
  results?: MemoryResult[];
}

export function formatContextForPrompt(
  profile: ProfileResponse | null,
  userMemories: MemoriesResponseMinimal,
  projectMemories: MemoriesResponseMinimal
): string {
  const parts: string[] = ["[GRAPHITI MEMORY]"];

  if (CONFIG.injectProfile && profile?.profile) {
    const { static: staticFacts, dynamic: dynamicFacts } = profile.profile;

    if (staticFacts.length > 0) {
      parts.push("\nUser Profile:");
      staticFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }

    if (dynamicFacts.length > 0) {
      parts.push("\nRecent Context:");
      dynamicFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }
  }

  const projectResults = projectMemories.results || [];
  if (CONFIG.injectProjectMemories && projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      const similarity = Math.round(mem.similarity * 100);
      const content = mem.memory || "";
      const typeTag = mem.type ? `[${mem.type}]` : "";
      parts.push(`- ${typeTag}[${similarity}%] ${content}`);
    });
  }

  const userResults = userMemories.results || [];
  if (CONFIG.injectRelevantMemories && userResults.length > 0) {
    parts.push("\nRelevant Memories:");
    userResults.forEach((mem) => {
      const similarity = Math.round(mem.similarity * 100);
      const content = mem.memory || "";
      const typeTag = mem.type ? `[${mem.type}]` : "";
      parts.push(`- ${typeTag}[${similarity}%] ${content}`);
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}
