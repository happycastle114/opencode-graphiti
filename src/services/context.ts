import { CONFIG } from "../config.js";
import type { UserProfile, MemoryResult } from "../types/index.js";

interface ProfileResponse {
  profile?: UserProfile;
}

interface MemoriesResponseMinimal {
  results?: MemoryResult[];
}

function formatTemporalTag(mem: MemoryResult): string {
  if (mem.validAt) {
    const validDate = new Date(mem.validAt);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - validDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) return "[recent]";
    if (daysDiff <= 7) return "[this week]";
    if (daysDiff <= 30) return "[this month]";
    return `[${daysDiff}d ago]`;
  }
  return "";
}

function memoryTimestamp(mem: MemoryResult): number {
  const value = mem.validAt ?? mem.createdAt;
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function prioritizeMemories(memories: MemoryResult[]): MemoryResult[] {
  return [...memories].sort((left, right) => {
    const similarityDifference = (right.similarity ?? -1) - (left.similarity ?? -1);
    if (similarityDifference !== 0) return similarityDifference;

    const recencyDifference = memoryTimestamp(right) - memoryTimestamp(left);
    if (recencyDifference !== 0) return recencyDifference;

    return left.id.localeCompare(right.id);
  });
}

function formatMemoryLine(mem: MemoryResult): string {
  const content = mem.memory || "";
  const typeTag = mem.type ? `[${mem.type}]` : "";
  const temporalTag = formatTemporalTag(mem);
  const labelTag = mem.labels?.length ? `[${mem.labels.join(",")}]` : "";
  const similarityTag = mem.similarity != null ? `[${Math.round(mem.similarity * 100)}%]` : "";
  
  const tags = [typeTag, labelTag, temporalTag, similarityTag]
    .filter(Boolean)
    .join("");
  
  return `- ${tags} ${content}`;
}

export function formatContextForPrompt(
  profile: ProfileResponse | null,
  userMemories: MemoriesResponseMinimal,
  projectMemories: MemoriesResponseMinimal
): string {
  const parts: string[] = ["[GRAPHITI MEMORY - Temporal Knowledge Graph]"];

  if (CONFIG.injectProfile && profile?.profile) {
    const staticFacts = [...profile.profile.static].sort((left, right) => left.localeCompare(right));
    const dynamicFacts = [...profile.profile.dynamic].sort((left, right) => left.localeCompare(right));

    if (staticFacts.length > 0) {
      parts.push("\nUser Preferences (stable):");
      staticFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }

    if (dynamicFacts.length > 0) {
      parts.push("\nRecent Context (dynamic):");
      dynamicFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }
  }

  const userResults = prioritizeMemories(userMemories.results || []);
  if (CONFIG.injectRelevantMemories && userResults.length > 0) {
    parts.push("\nUser Memory Priorities:");
    userResults.forEach((mem) => {
      parts.push(formatMemoryLine(mem));
    });
  }

  const projectResults = prioritizeMemories(projectMemories.results || []);
  if (CONFIG.injectProjectMemories && projectResults.length > 0) {
    parts.push("\nProject Knowledge (entities & facts):");
    projectResults.forEach((mem) => {
      parts.push(formatMemoryLine(mem));
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}
