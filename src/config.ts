import { existsSync, readFileSync, statSync } from "node:fs";
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
  /**
   * "hashed" (default): `${prefix}_user_<sha(email)>` / `${prefix}_project_<sha(dir)>`.
   * "scoped": user group `user` (or userGroupId) and project group
   * `project-<owner-repo>` from the git remote, the same id every client uses.
   */
  groupScheme?: "hashed" | "scoped";
  similarityThreshold?: number;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  injectProjectMemories?: boolean;
  injectRelevantMemories?: boolean;
  autoSaveTurns?: boolean;
  autoSavePreferences?: boolean;
  autoSaveSessionDigests?: boolean;
  enableReplay?: boolean;
  enableCompaction?: boolean;
  sharedGroupIds?: string[];
  entityTypes?: string[];
}

const DEFAULTS: Required<Omit<GraphitiConfig, "userGroupId" | "groupScheme">> = {
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
  autoSaveTurns: true,
  autoSavePreferences: true,
  autoSaveSessionDigests: true,
  enableReplay: true,
  enableCompaction: false,
  sharedGroupIds: [],
  entityTypes: ["Preference", "Requirement", "Procedure", "Location", "Event", "Organization", "Document", "Topic", "Object", "Error", "Lesson", "Pattern"],
};

/** Track config file modification time for hot-reload */
let _cachedConfig: GraphitiConfig | null = null;
let _cachedConfigPath: string | null = null;
let _cachedConfigMtime: number = 0;

function findConfigFile(): string | null {
  for (const path of CONFIG_FILES) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function loadConfigFromFile(path: string): GraphitiConfig {
  try {
    const content = readFileSync(path, "utf-8");
    const json = stripJsoncComments(content);
    return JSON.parse(json) as GraphitiConfig;
  } catch {
    return {};
  }
}

function loadConfig(): GraphitiConfig {
  const configPath = findConfigFile();
  if (!configPath) {
    _cachedConfig = {};
    _cachedConfigPath = null;
    _cachedConfigMtime = 0;
    return {};
  }

  try {
    const stat = statSync(configPath);
    const mtime = stat.mtimeMs;

    // Return cached if file hasn't changed
    if (_cachedConfig && _cachedConfigPath === configPath && _cachedConfigMtime === mtime) {
      return _cachedConfig;
    }

    const config = loadConfigFromFile(configPath);
    _cachedConfig = config;
    _cachedConfigPath = configPath;
    _cachedConfigMtime = mtime;
    return config;
  } catch {
    return _cachedConfig || {};
  }
}

// Initial load
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

export const GROUP_SCHEME: "hashed" | "scoped" =
  (fileConfig.groupScheme ?? process.env.GRAPHITI_GROUP_SCHEME) === "scoped" ? "scoped" : "hashed";

export const USER_GROUP_ID: string | undefined =
  fileConfig.userGroupId ?? process.env.GRAPHITI_USER_GROUP_ID ?? undefined;

export const GROUP_ID_PREFIX = 
  fileConfig.groupIdPrefix ?? 
  process.env.GRAPHITI_GROUP_ID_PREFIX ?? 
  DEFAULTS.groupIdPrefix;

/**
 * CONFIG object with hot-reload support.
 * Re-reads config file on each property access if the file has been modified.
 * Note: mcpUrl, restUrl, useRestApi, groupIdPrefix are read once at startup
 * (changing them requires restart). All other values support hot-reload.
 */
function createHotReloadConfig() {
  const staticValues = {
    mcpUrl: GRAPHITI_MCP_URL,
    restUrl: GRAPHITI_REST_URL,
    useRestApi: USE_REST_API,
    groupIdPrefix: GROUP_ID_PREFIX,
  };

  function getReloadableValue<K extends keyof GraphitiConfig>(key: K): GraphitiConfig[K] | undefined {
    const fresh = loadConfig();
    return fresh[key];
  }

  return {
    get mcpUrl() { return staticValues.mcpUrl; },
    get restUrl() { return staticValues.restUrl; },
    get useRestApi() { return staticValues.useRestApi; },
    get groupIdPrefix() { return staticValues.groupIdPrefix; },
    get similarityThreshold() { return getReloadableValue("similarityThreshold") ?? DEFAULTS.similarityThreshold; },
    get maxMemories() { return getReloadableValue("maxMemories") ?? DEFAULTS.maxMemories; },
    get maxProjectMemories() { return getReloadableValue("maxProjectMemories") ?? DEFAULTS.maxProjectMemories; },
    get maxProfileItems() { return getReloadableValue("maxProfileItems") ?? DEFAULTS.maxProfileItems; },
    get injectProfile() { return getReloadableValue("injectProfile") ?? DEFAULTS.injectProfile; },
    get injectProjectMemories() { return getReloadableValue("injectProjectMemories") ?? DEFAULTS.injectProjectMemories; },
    get injectRelevantMemories() { return getReloadableValue("injectRelevantMemories") ?? DEFAULTS.injectRelevantMemories; },
    get autoSaveTurns() { return getReloadableValue("autoSaveTurns") ?? DEFAULTS.autoSaveTurns; },
    get autoSavePreferences() { return getReloadableValue("autoSavePreferences") ?? DEFAULTS.autoSavePreferences; },
    get autoSaveSessionDigests() { return getReloadableValue("autoSaveSessionDigests") ?? DEFAULTS.autoSaveSessionDigests; },
    get enableReplay() { return getReloadableValue("enableReplay") ?? DEFAULTS.enableReplay; },
    get enableCompaction() { return getReloadableValue("enableCompaction") ?? DEFAULTS.enableCompaction; },
    get sharedGroupIds() { return getReloadableValue("sharedGroupIds") ?? DEFAULTS.sharedGroupIds; },
    get entityTypes() { return getReloadableValue("entityTypes") ?? DEFAULTS.entityTypes; },
  };
}

export const CONFIG = createHotReloadConfig();

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
