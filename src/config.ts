import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "graphiti.jsonc"),
  join(CONFIG_DIR, "graphiti.json"),
  // Fallback to supermemory config for backwards compatibility
  join(CONFIG_DIR, "supermemory.jsonc"),
  join(CONFIG_DIR, "supermemory.json"),
];

interface GraphitiConfig {
  mcpUrl?: string;
  restUrl?: string;
  useRestApi?: boolean;
  userGroupId?: string;
  groupIdPrefix?: string;
  similarityThreshold?: number;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  injectProjectMemories?: boolean;
  injectRelevantMemories?: boolean;
  entityTypes?: string[];
}

const DEFAULTS: Required<Omit<GraphitiConfig, "userGroupId">> = {
  mcpUrl: "http://localhost:8000/mcp/",
  restUrl: "http://localhost:8000",
  useRestApi: true,
  groupIdPrefix: "opencode",
  similarityThreshold: 0.6,
  maxMemories: 5,
  maxProjectMemories: 10,
  maxProfileItems: 5,
  injectProfile: true,
  injectProjectMemories: true,
  injectRelevantMemories: true,
  entityTypes: ["Preference", "Requirement", "Procedure", "Topic"],
};

function loadConfig(): GraphitiConfig {
  for (const path of CONFIG_FILES) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as GraphitiConfig;
      } catch {
        // Invalid config, continue to next file
      }
    }
  }
  return {};
}

const fileConfig = loadConfig();

export const GRAPHITI_MCP_URL = 
  fileConfig.mcpUrl ?? 
  process.env.GRAPHITI_MCP_URL ?? 
  DEFAULTS.mcpUrl;

export const GRAPHITI_REST_URL = 
  fileConfig.restUrl ?? 
  process.env.GRAPHITI_REST_URL ?? 
  DEFAULTS.restUrl;

export const USE_REST_API = 
  fileConfig.useRestApi ?? 
  (process.env.GRAPHITI_USE_REST_API === "true" || process.env.GRAPHITI_USE_REST_API === undefined) ??
  DEFAULTS.useRestApi;

export const GROUP_ID_PREFIX = 
  fileConfig.groupIdPrefix ?? 
  process.env.GRAPHITI_GROUP_ID_PREFIX ?? 
  DEFAULTS.groupIdPrefix;

export const CONFIG = {
  mcpUrl: GRAPHITI_MCP_URL,
  restUrl: GRAPHITI_REST_URL,
  useRestApi: USE_REST_API,
  groupIdPrefix: GROUP_ID_PREFIX,
  similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
  maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
  maxProjectMemories: fileConfig.maxProjectMemories ?? DEFAULTS.maxProjectMemories,
  maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
  injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
  injectProjectMemories: fileConfig.injectProjectMemories ?? DEFAULTS.injectProjectMemories,
  injectRelevantMemories: fileConfig.injectRelevantMemories ?? DEFAULTS.injectRelevantMemories,
  entityTypes: fileConfig.entityTypes ?? DEFAULTS.entityTypes,
};

/**
 * Check if Graphiti MCP server is configured and reachable
 * Returns true if GRAPHITI_MCP_URL is set (we'll verify connectivity at runtime)
 */
export function isConfigured(): boolean {
  return !!GRAPHITI_MCP_URL;
}

/**
 * Verify Graphiti MCP server is actually reachable
 */
export async function verifyConnection(): Promise<boolean> {
  try {
    const response = await fetch(GRAPHITI_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_status", arguments: {} },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
