import type { MemoryScope } from "../types/index.js";
import { hasDurableUserPreferenceSignal } from "./memory-enhancement.js";

export function classifyMemoryScope(content: string): MemoryScope {
  return hasDurableUserPreferenceSignal(content) ? "user" : "project";
}
