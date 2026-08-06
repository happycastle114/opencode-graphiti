const GRAPHITI_HEADER = "[GRAPHITI MEMORY - Temporal Knowledge Graph]";
const GRAPHITI_SECTION_PATTERN = /^(?:User Preferences \(stable\)|Recent Context \(dynamic\)|User Memory Priorities|Project Knowledge \(entities & facts\)):\s*$/i;
const SYSTEM_REMINDER_PATTERN = /<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi;
const DIGEST_WRAPPER_PATTERN = /<\/?session-(?:digest|summary)\b[^>]*>/gi;
const DIGEST_HEADER_PATTERN = /^\[(?:Session Digest|Session Summary)\]$/i;
const DIGEST_METADATA_PATTERN = /^(?:Session:|Captured exchanges:)\s*/i;
const MEMORY_TRIGGER_HEADER = "[MEMORY TRIGGER DETECTED]";
const MEMORY_TRIGGER_OPENING_PATTERN = /^The user wants you to remember something\./i;
const MEMORY_TRIGGER_END_PATTERN = /^DO NOT skip this step\.[^\n]*$/i;
const NOISE_ONLY_PATTERN = /^(?:\[REDACTED\]\s*)+$/i;

function stripInjectedLineBlocks(text: string): string {
  const retainedLines: string[] = [];
  let graphitiBlock = false;
  let graphitiSection = false;
  let memoryTriggerBlock = false;
  let pendingGraphitiHeader: string | null = null;
  let pendingMemoryTriggerHeader: string | null = null;
  let digestMetadata = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    if (pendingGraphitiHeader !== null) {
      if (trimmed === "") continue;
      if (GRAPHITI_SECTION_PATTERN.test(trimmed)) {
        graphitiBlock = true;
        graphitiSection = true;
        pendingGraphitiHeader = null;
        continue;
      }
      retainedLines.push(pendingGraphitiHeader);
      pendingGraphitiHeader = null;
    }

    if (trimmed.toLowerCase() === GRAPHITI_HEADER.toLowerCase()) {
      pendingGraphitiHeader = line;
      continue;
    }

    if (graphitiBlock) {
      if (trimmed === "") continue;
      if (GRAPHITI_SECTION_PATTERN.test(trimmed)) {
        graphitiSection = true;
        continue;
      }
      if (graphitiSection && (trimmed.startsWith("- ") || /^\s/.test(line))) continue;
      graphitiBlock = false;
      graphitiSection = false;
    }

    if (pendingMemoryTriggerHeader !== null) {
      if (trimmed === "") continue;
      if (MEMORY_TRIGGER_OPENING_PATTERN.test(trimmed)) {
        memoryTriggerBlock = true;
        pendingMemoryTriggerHeader = null;
        continue;
      }
      retainedLines.push(pendingMemoryTriggerHeader);
      pendingMemoryTriggerHeader = null;
    }

    if (trimmed.toLowerCase() === MEMORY_TRIGGER_HEADER.toLowerCase()) {
      pendingMemoryTriggerHeader = line;
      continue;
    }

    if (memoryTriggerBlock) {
      if (MEMORY_TRIGGER_END_PATTERN.test(trimmed)) memoryTriggerBlock = false;
      continue;
    }

    if (DIGEST_HEADER_PATTERN.test(trimmed)) {
      digestMetadata = true;
      continue;
    }

    if (digestMetadata && (trimmed === "" || DIGEST_METADATA_PATTERN.test(trimmed))) {
      continue;
    }
    digestMetadata = false;
    retainedLines.push(line);
  }

  if (pendingGraphitiHeader !== null) retainedLines.push(pendingGraphitiHeader);
  if (pendingMemoryTriggerHeader !== null) retainedLines.push(pendingMemoryTriggerHeader);

  return retainedLines.join("\n");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeTextForStorage(text: string): string {
  const withoutBlockTags = text
    .replace(/\r\n?/g, "\n")
    .replace(SYSTEM_REMINDER_PATTERN, "")
    .replace(DIGEST_WRAPPER_PATTERN, "");

  return normalizeWhitespace(stripInjectedLineBlocks(withoutBlockTags));
}

export function isStorageWorthy(text: string): boolean {
  const sanitized = sanitizeTextForStorage(text);
  return sanitized.length > 0
    && !NOISE_ONLY_PATTERN.test(sanitized)
    && /[\p{L}\p{N}]/u.test(sanitized);
}
