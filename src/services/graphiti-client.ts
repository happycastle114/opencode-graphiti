import { CONFIG, GRAPHITI_MCP_URL } from "../config.js";
import { assertNonEmptyGroupIds } from "./group-ids.js";
import { log } from "./logger.js";
import { redactForLog } from "./privacy.js";
import { profileCache } from "./profile-cache.js";
import type {
  MemoryType,
  EpisodeSource,
  GraphitiNodeResult,
  GraphitiFactResult,
  GraphitiEpisodeResult,
  MemoryResult,
} from "../types/index.js";

const TIMEOUT_MS = 30000;

interface MCPRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

interface MCPToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
  [key: string]: unknown;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

let requestId = 0;

export class GraphitiClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.baseUrl = GRAPHITI_MCP_URL || "http://localhost:8000/mcp/";
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initializeSession();
    await this.initPromise;
  }

  private async initializeSession(): Promise<void> {
    const initRequest: MCPRequest = {
      jsonrpc: "2.0",
      id: ++requestId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "opencode-graphiti", version: "0.2.0" },
      },
    };

    const initResponse = await withTimeout(
      fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/event-stream",
        },
        body: JSON.stringify(initRequest),
      }),
      TIMEOUT_MS
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      throw new Error(`MCP init failed: HTTP ${initResponse.status}: ${errorText}`);
    }

    this.sessionId = initResponse.headers.get("mcp-session-id");
    await initResponse.text();

    await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Session-Id": this.sessionId || "",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    
    log("graphiti.session: initialized", { sessionId: this.sessionId?.slice(0, 8) });
  }

  private async callMCPTool<T>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    await this.ensureSession();

    const request: MCPRequest = {
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      } as MCPToolCallParams,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const response = await withTimeout(
      fetch(this.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      }),
      TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 400 && errorText.includes("session")) {
        this.sessionId = null;
        this.initPromise = null;
        return this.callMCPTool(toolName, args);
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    let result: MCPResponse<T>;

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const parsed = this.parseSSE<T>(text);
      if (!parsed) {
        throw new Error("Failed to parse SSE response");
      }
      result = parsed;
    } else {
      result = (await response.json()) as MCPResponse<T>;
    }

    if (result.error) {
      throw new Error(`MCP Error: ${result.error.message}`);
    }

    return this.unwrapToolResult<T>(result.result);
  }

  private unwrapToolResult<T>(result: unknown): T {
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      if (Array.isArray(content) && content.length > 0) {
        const textContent = content.find((c) => c.type === "text" && c.text);
        if (textContent?.text) {
          try {
            return JSON.parse(textContent.text) as T;
          } catch {
            return textContent.text as unknown as T;
          }
        }
      }
    }
    return result as T;
  }

  private parseSSE<T>(text: string): MCPResponse<T> | null {
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.slice(6)) as MCPResponse<T>;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  async addMemory(
    content: string,
    groupId: string,
    metadata?: { 
      type?: MemoryType; 
      name?: string; 
      uuid?: string; 
      source?: EpisodeSource;
      [key: string]: unknown 
    }
  ) {
    assertNonEmptyGroupIds([groupId]);
    log("graphiti.addMemory: start", { groupId, contentLength: content.length });
    try {
      const source = metadata?.source || this.inferSource(content);
      const args: Record<string, unknown> = {
        name: metadata?.name || `Memory ${Date.now()}`,
        episode_body: content,
        group_id: groupId,
        source,
        source_description: metadata?.type || "opencode-memory",
      };
      
      if (metadata?.uuid) {
        args.uuid = metadata.uuid;
      }
      
      const result = await this.callMCPTool<{ message: string }>("add_memory", args);
      log("graphiti.addMemory: success", { message: result.message, source });
      const isProfileMemory = metadata?.type === "preference" || metadata?.type === "style";
      if ((metadata?.name?.startsWith("profile-") || groupId.includes("_user_")) && isProfileMemory) {
        try {
          await profileCache.save(groupId, content);
        } catch (cacheError) {
          log("graphiti.addMemory: profile cache write failed", {
            error: cacheError instanceof Error ? cacheError.message : String(cacheError),
          });
        }
      }
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.addMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  private inferSource(content: string): EpisodeSource {
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch {
        return "text";
      }
    }
    if (trimmed.includes('"role":') && (trimmed.includes('"user"') || trimmed.includes('"assistant"'))) {
      return "message";
    }
    return "text";
  }

  async searchNodes(
    query: string,
    groupIds: string[],
    options?: { maxNodes?: number; entityTypes?: string[] }
  ) {
    assertNonEmptyGroupIds(groupIds);
    log("graphiti.searchNodes: start", { groupIds, query: redactForLog(query) });
    try {
      const result = await this.callMCPTool<{ nodes: GraphitiNodeResult[] }>(
        "search_nodes",
        {
          query,
          group_ids: groupIds,
          max_nodes: options?.maxNodes || CONFIG.maxMemories,
          entity_types: options?.entityTypes,
        }
      );
      log("graphiti.searchNodes: success", { count: result.nodes?.length || 0 });
      return {
        success: true as const,
        nodes: result.nodes || [],
        total: result.nodes?.length || 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.searchNodes: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, nodes: [], total: 0 };
    }
  }

  async searchFacts(
    query: string,
    groupIds: string[],
    options?: { maxFacts?: number; centerNodeUuid?: string }
  ) {
    assertNonEmptyGroupIds(groupIds);
    log("graphiti.searchFacts: start", { groupIds, query: redactForLog(query) });
    try {
      const result = await this.callMCPTool<{ facts: GraphitiFactResult[] }>(
        "search_memory_facts",
        {
          query,
          group_ids: groupIds,
          max_facts: options?.maxFacts || CONFIG.maxMemories,
          center_node_uuid: options?.centerNodeUuid,
        }
      );
      const facts: GraphitiFactResult[] = (result.facts || []).map((fact) => ({
        uuid: fact.uuid,
        name: fact.name,
        fact: fact.fact,
        source_node_uuid: fact.source_node_uuid,
        target_node_uuid: fact.target_node_uuid,
        created_at: fact.created_at,
        valid_at: fact.valid_at,
        invalid_at: fact.invalid_at,
        expired_at: fact.expired_at,
        group_id: fact.group_id,
        episodes: fact.episodes,
      }));
      log("graphiti.searchFacts: success", { count: facts.length });
      return {
        success: true as const,
        facts,
        total: facts.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.searchFacts: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, facts: [], total: 0 };
    }
  }

  async getEpisodes(groupIds: string[], maxEpisodes?: number) {
    assertNonEmptyGroupIds(groupIds);
    log("graphiti.getEpisodes: start", { groupIds, maxEpisodes });
    try {
      const result = await this.callMCPTool<{ episodes: GraphitiEpisodeResult[] }>(
        "get_episodes",
        {
          group_ids: groupIds,
          max_episodes: maxEpisodes || CONFIG.maxProjectMemories,
        }
      );
      log("graphiti.getEpisodes: success", { count: result.episodes?.length || 0 });
      return {
        success: true as const,
        episodes: result.episodes || [],
        total: result.episodes?.length || 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getEpisodes: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, episodes: [], total: 0 };
    }
  }

  async deleteEpisode(uuid: string) {
    log("graphiti.deleteEpisode: start", { uuid });
    try {
      const result = await this.callMCPTool<{ message: string }>("delete_episode", {
        uuid,
      });
      log("graphiti.deleteEpisode: success", { uuid });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.deleteEpisode: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async deleteEntityEdge(uuid: string) {
    log("graphiti.deleteEntityEdge: start", { uuid });
    try {
      const result = await this.callMCPTool<{ message: string }>("delete_entity_edge", {
        uuid,
      });
      log("graphiti.deleteEntityEdge: success", { uuid });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.deleteEntityEdge: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async getEntityEdge(uuid: string) {
    log("graphiti.getEntityEdge: start", { uuid });
    try {
      const result = await this.callMCPTool<GraphitiFactResult>("get_entity_edge", {
        uuid,
      });
      const edge: GraphitiFactResult = {
        uuid: result.uuid,
        name: result.name,
        fact: result.fact,
        source_node_uuid: result.source_node_uuid,
        target_node_uuid: result.target_node_uuid,
        created_at: result.created_at,
        valid_at: result.valid_at,
        invalid_at: result.invalid_at,
        expired_at: result.expired_at,
        group_id: result.group_id,
        episodes: result.episodes,
      };
      log("graphiti.getEntityEdge: success", { uuid });
      return { success: true as const, edge };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getEntityEdge: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage, edge: null };
    }
  }

  async clearGraph(groupIds?: string[]) {
    if (groupIds !== undefined) {
      assertNonEmptyGroupIds(groupIds);
    }
    log("graphiti.clearGraph: start", { groupIds });
    try {
      const result = await this.callMCPTool<{ message: string }>("clear_graph", {
        group_ids: groupIds,
      });
      log("graphiti.clearGraph: success", { groupIds });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.clearGraph: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async getStatus() {
    log("graphiti.getStatus: start");
    try {
      const result = await this.callMCPTool<{ status: string; message: string }>(
        "get_status",
        {}
      );
      log("graphiti.getStatus: success", { status: result.status });
      return { success: true as const, ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getStatus: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, status: "error", message: errorMessage };
    }
  }

  async searchMemories(query: string, groupId: string, options?: {
    centerNodeUuid?: string;
    entityTypes?: string[];
    messages?: Array<{ content: string; role: "user" | "assistant" | "system" }>;
  }) {
    assertNonEmptyGroupIds([groupId]);
    log("graphiti.searchMemories: start", { groupId });
    try {
      const [nodesResult, factsResult] = await Promise.all([
        this.searchNodes(query, [groupId], { 
          maxNodes: CONFIG.maxMemories,
          entityTypes: options?.entityTypes || CONFIG.entityTypes as string[],
        }),
        this.searchFacts(query, [groupId], { 
          maxFacts: CONFIG.maxMemories,
          centerNodeUuid: options?.centerNodeUuid,
        }),
      ]);

      const validFacts = (factsResult.facts || []).filter((fact) => !fact.invalid_at);

      const results: MemoryResult[] = [
        ...(nodesResult.nodes || []).map((node) => ({
          id: node.uuid,
          memory: node.summary || node.name,
          similarity: null as number | null,
          type: "node" as const,
          labels: node.labels,
          groupId: node.group_id,
          createdAt: node.created_at,
        })),
        ...validFacts.map((fact) => ({
          id: fact.uuid || `fact-${Date.now()}`,
          memory: this.formatFactWithRelationship(fact),
          similarity: null as number | null,
          type: "fact" as const,
          groupId: fact.group_id,
          createdAt: fact.created_at,
          validAt: fact.valid_at,
          invalidAt: fact.invalid_at,
          sourceNode: fact.source_node_uuid,
          targetNode: fact.target_node_uuid,
        })),
      ];

      log("graphiti.searchMemories: success", { 
        nodesCount: nodesResult.nodes?.length || 0,
        factsCount: validFacts.length,
        filteredInvalid: (factsResult.facts?.length || 0) - validFacts.length,
      });

      return {
        success: true as const,
        results,
        total: results.length,
        timing: 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.searchMemories: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }

  private formatFactWithRelationship(fact: GraphitiFactResult): string {
    const content = fact.fact || fact.name || "";
    if (fact.source_node_uuid && fact.target_node_uuid) {
      return content;
    }
    return content;
  }

  async getProfile(userGroupId: string, query?: string) {
    assertNonEmptyGroupIds([userGroupId]);
    log("graphiti.getProfile: start", { userGroupId });
    try {
      const searchQuery = query || "user preferences settings configuration";
      
      const nodesResult = await this.searchNodes(searchQuery, [userGroupId], {
        maxNodes: CONFIG.maxProfileItems * 2,
        entityTypes: ["Preference", "Requirement"],
      });

      // Format as profile-like structure
      const staticFacts: string[] = [];
      const dynamicFacts: string[] = [];

      for (const node of nodesResult.nodes || []) {
        const content = node.summary || node.name;
        if (node.labels?.includes("Preference")) {
          staticFacts.push(content);
        } else {
          dynamicFacts.push(content);
        }
      }
      const cachedFacts = profileCache.read(userGroupId);
      const mergedFacts = [...new Set([...cachedFacts, ...staticFacts])].slice(0, CONFIG.maxProfileItems);

      log("graphiti.getProfile: success", {
        staticCount: mergedFacts.length,
        dynamicCount: dynamicFacts.length,
      });

      return {
        success: true as const,
        profile: {
          static: mergedFacts,
          dynamic: dynamicFacts.slice(0, CONFIG.maxProfileItems),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getProfile: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, profile: null };
    }
  }

  async listMemories(groupId: string, limit = 20) {
    assertNonEmptyGroupIds([groupId]);
    log("graphiti.listMemories: start", { groupId, limit });
    try {
      const result = await this.getEpisodes([groupId], limit);
      
      const memories = (result.episodes || []).map((ep) => ({
        id: ep.uuid,
        summary: ep.content || ep.name,
        title: ep.name,
        createdAt: ep.created_at,
        metadata: {
          source: ep.source,
          source_description: ep.source_description,
        },
      }));

      log("graphiti.listMemories: success", { count: memories.length });
      return {
        success: true as const,
        memories,
        pagination: {
          currentPage: 1,
          totalItems: memories.length,
          totalPages: 1,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.listMemories: error", { error: errorMessage });
      return {
        success: false as const,
        error: errorMessage,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 },
      };
    }
  }

  async deleteMemory(memoryId: string) {
    return this.deleteEpisode(memoryId);
  }
}

export const graphitiClient = new GraphitiClient();
