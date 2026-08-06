export function containsPrivateTag(content: string): boolean {
  return /<private>[\s\S]*?<\/private>/i.test(content);
}

export function stripPrivateContent(content: string): string {
  return content.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}

export function isFullyPrivate(content: string): boolean {
  const stripped = stripPrivateContent(content).trim();
  return stripped === "[REDACTED]" || stripped === "";
}

export interface RedactedLogPreview {
  redacted: true;
  hash8: string;
  length: number;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aHash8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function redactForLog(text: string): RedactedLogPreview {
  return {
    redacted: true,
    hash8: fnv1aHash8(text),
    length: text.length,
  };
}
