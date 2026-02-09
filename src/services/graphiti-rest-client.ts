/**
 * Graphiti REST API Client
 * 
 * Uses the Graphiti REST API instead of MCP for simpler integration.
 * REST API endpoints: /messages, /search, /get-memory, /episodes, etc.
 */

import { CONFIG, GRAPHITI_REST_URL } from "../config.js";
import { log } from "./logger.js";
import type {
  MemoryType,
  EpisodeSource,
  GraphitiNodeResult,
  GraphitiFactResult,
  GraphitiEpisodeResult,
} from "../types/index.js";

const TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// REST API Request/Response Types based on OpenAPI spec
interface Message {
  content: string;
  role_type: "user" | "assistant" | "system";
  role: string | null;
  timestamp: string;
  uuid?: string;
  name?: string;
  source_description?: string;
}

interface AddMessagesRequest {
  group_id: string;
  messages: Message[];
}

interface SearchQuery {
  query: string;
  group_ids?: string[] | null;
  max_facts?: number;
}

interface GetMemoryRequest {
  group_id: string;
  max_facts?: number;
  center_node_uuid?: string | null;
  messages: Message[];
}

interface AddEntityNodeRequest {
  uuid: string;
  group_id: string;
  name: string;
  summary?: string;
}

// REST API Fact result (slightly different from MCP)
interface RESTFactResult {
  uuid: string;
  name: string;
  fact: string;
  source_node_uuid?: string;
  target_node_uuid?: string;
  created_at?: string;
  valid_at?: string;
  invalid_at?: string;
  expired_at?: string;
  group_id?: string;
  episodes?: string[];
}

// REST API Episode result
interface RESTEpisodeResult {
  uuid: string;
  name: string;
  content: string;
  created_at: string;
  source: string;
  source_description: string;
  group_id: string;
  valid_at?: string;
  entity_edges?: string[];
}

export class GraphitiRestClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = GRAPHITI_REST_URL || "http://localhost:8000";
    // Remove trailing slash if present
    if (this.baseUrl.endsWith("/")) {
      this.baseUrl = this.baseUrl.slice(0, -1);
    }
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await withTimeout(fetch(url, options), TIMEOUT_MS);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Add memory as a message to the knowledge graph
   */
  async addMemory(
    content: string,
    groupId: string,
    metadata?: {
      type?: MemoryType;
      name?: string;
      uuid?: string;
      source?: EpisodeSource;
      [key: string]: unknown;
    }
  ) {
    log("graphiti.addMemory: start", { groupId, contentLength: content.length });
    try {
      const message: Message = {
        content,
        role_type: "user",
        role: metadata?.type || "memory",
        timestamp: new Date().toISOString(),
        name: metadata?.name,
        source_description: metadata?.type || "opencode-memory",
      };

      if (metadata?.uuid) {
        message.uuid = metadata.uuid;
      }

      const request: AddMessagesRequest = {
        group_id: groupId,
        messages: [message],
      };

      const result = await this.request<{ message: string; success: boolean }>(
        "POST",
        "/messages",
        request
      );

      log("graphiti.addMemory: success", { message: result.message });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.addMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Search for facts in the knowledge graph
   */
  async searchFacts(
    query: string,
    groupIds: string[],
    options?: { maxFacts?: number }
  ) {
    log("graphiti.searchFacts: start", { groupIds, query: query.slice(0, 50) });
    try {
      const searchQuery: SearchQuery = {
        query,
        group_ids: groupIds.length > 0 ? groupIds : null,
        max_facts: options?.maxFacts || CONFIG.maxMemories,
      };

      const result = await this.request<{ facts: RESTFactResult[] }>(
        "POST",
        "/search",
        searchQuery
      );

      const facts: GraphitiFactResult[] = (result.facts || []).map((f) => ({
        uuid: f.uuid,
        name: f.name,
        fact: f.fact,
        source_node_uuid: f.source_node_uuid,
        target_node_uuid: f.target_node_uuid,
        created_at: f.created_at,
        valid_at: f.valid_at,
        invalid_at: f.invalid_at,
        group_id: f.group_id,
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

  /**
   * Get memory using conversation context
   * This is the primary retrieval method for the REST API
   */
  async getMemory(
    groupId: string,
    messages: Array<{ content: string; role: "user" | "assistant" | "system" }>,
    options?: { maxFacts?: number; centerNodeUuid?: string }
  ) {
    log("graphiti.getMemory: start", { groupId, messageCount: messages.length });
    try {
      const request: GetMemoryRequest = {
        group_id: groupId,
        max_facts: options?.maxFacts || CONFIG.maxMemories,
        center_node_uuid: options?.centerNodeUuid || null,
        messages: messages.map((m) => ({
          content: m.content,
          role_type: m.role,
          role: null,
          timestamp: new Date().toISOString(),
        })),
      };

      const result = await this.request<{ facts: RESTFactResult[] }>(
        "POST",
        "/get-memory",
        request
      );

      const facts: GraphitiFactResult[] = (result.facts || []).map((f) => ({
        uuid: f.uuid,
        name: f.name,
        fact: f.fact,
        source_node_uuid: f.source_node_uuid,
        target_node_uuid: f.target_node_uuid,
        created_at: f.created_at,
        valid_at: f.valid_at,
        invalid_at: f.invalid_at,
        group_id: f.group_id,
      }));

      log("graphiti.getMemory: success", { count: facts.length });
      return {
        success: true as const,
        facts,
        total: facts.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, facts: [], total: 0 };
    }
  }

  /**
   * Get episodes for a group
   */
  async getEpisodes(groupIds: string[], maxEpisodes?: number) {
    log("graphiti.getEpisodes: start", { groupIds, maxEpisodes });
    try {
      // REST API only supports single group_id
      const groupId = groupIds[0];
      if (!groupId) {
        return { success: true as const, episodes: [], total: 0 };
      }

      const limit = maxEpisodes || CONFIG.maxProjectMemories;
      const result = await this.request<RESTEpisodeResult[]>(
        "GET",
        `/episodes/${encodeURIComponent(groupId)}?last_n=${limit}`
      );

      const episodes: GraphitiEpisodeResult[] = (result || []).map((ep) => ({
        uuid: ep.uuid,
        name: ep.name,
        content: ep.content,
        created_at: ep.created_at,
        source: ep.source,
        source_description: ep.source_description,
        group_id: ep.group_id,
      }));

      log("graphiti.getEpisodes: success", { count: episodes.length });
      return {
        success: true as const,
        episodes,
        total: episodes.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getEpisodes: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, episodes: [], total: 0 };
    }
  }

  /**
   * Delete an episode by UUID
   */
  async deleteEpisode(uuid: string) {
    log("graphiti.deleteEpisode: start", { uuid });
    try {
      const result = await this.request<{ message: string }>(
        "DELETE",
        `/episode/${encodeURIComponent(uuid)}`
      );
      log("graphiti.deleteEpisode: success", { uuid });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.deleteEpisode: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Get an entity edge by UUID
   */
  async getEntityEdge(uuid: string) {
    log("graphiti.getEntityEdge: start", { uuid });
    try {
      const result = await this.request<RESTFactResult>(
        "GET",
        `/entity-edge/${encodeURIComponent(uuid)}`
      );

      const edge: GraphitiFactResult = {
        uuid: result.uuid,
        name: result.name,
        fact: result.fact,
        source_node_uuid: result.source_node_uuid,
        target_node_uuid: result.target_node_uuid,
        created_at: result.created_at,
        valid_at: result.valid_at,
        invalid_at: result.invalid_at,
        group_id: result.group_id,
      };

      log("graphiti.getEntityEdge: success", { uuid });
      return { success: true as const, edge };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getEntityEdge: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage, edge: null };
    }
  }

  /**
   * Delete an entity edge by UUID
   */
  async deleteEntityEdge(uuid: string) {
    log("graphiti.deleteEntityEdge: start", { uuid });
    try {
      const result = await this.request<{ message: string }>(
        "DELETE",
        `/entity-edge/${encodeURIComponent(uuid)}`
      );
      log("graphiti.deleteEntityEdge: success", { uuid });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.deleteEntityEdge: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Add an entity node
   */
  async addEntityNode(
    uuid: string,
    groupId: string,
    name: string,
    summary?: string
  ) {
    log("graphiti.addEntityNode: start", { uuid, groupId, name });
    try {
      const request: AddEntityNodeRequest = {
        uuid,
        group_id: groupId,
        name,
        summary,
      };

      const result = await this.request<{ message: string }>(
        "POST",
        "/entity-node",
        request
      );
      log("graphiti.addEntityNode: success", { uuid });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.addEntityNode: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Delete a group (all data for a group_id)
   */
  async deleteGroup(groupId: string) {
    log("graphiti.deleteGroup: start", { groupId });
    try {
      const result = await this.request<{ message: string }>(
        "DELETE",
        `/group/${encodeURIComponent(groupId)}`
      );
      log("graphiti.deleteGroup: success", { groupId });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.deleteGroup: error", { groupId, error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Clear all data
   */
  async clearGraph(groupIds?: string[]) {
    log("graphiti.clearGraph: start", { groupIds });
    try {
      // REST API /clear doesn't support group filtering
      // If groupIds provided, delete each group individually
      if (groupIds && groupIds.length > 0) {
        for (const groupId of groupIds) {
          await this.deleteGroup(groupId);
        }
        return { success: true as const, message: `Cleared ${groupIds.length} groups` };
      }

      const result = await this.request<{ message: string }>("POST", "/clear");
      log("graphiti.clearGraph: success");
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.clearGraph: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  /**
   * Get server status (health check)
   */
  async getStatus() {
    log("graphiti.getStatus: start");
    try {
      const result = await this.request<{ status: string }>("GET", "/healthcheck");
      log("graphiti.getStatus: success", { status: result.status });
      return {
        success: true as const,
        status: result.status === "healthy" ? "ok" : result.status,
        message: `Graphiti REST API is ${result.status}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getStatus: error", { error: errorMessage });
      return {
        success: false as const,
        error: errorMessage,
        status: "error",
        message: errorMessage,
      };
    }
  }

  /**
   * Search memories (unified search combining facts)
   * Note: REST API doesn't have separate node search, so we only search facts.
   * When messages are provided, uses getMemory() for conversation-aware retrieval.
   */
  async searchMemories(
    query: string,
    groupId: string,
    options?: {
      centerNodeUuid?: string;
      entityTypes?: string[];
      messages?: Array<{ content: string; role: "user" | "assistant" | "system" }>;
    }
  ) {
    log("graphiti.searchMemories: start", { groupId, hasMessages: !!(options?.messages?.length) });
    try {
      let factsResult: { facts: GraphitiFactResult[]; success: boolean };

      // Use getMemory for conversation-aware retrieval when messages are available
      if (options?.messages && options.messages.length > 0) {
        const memoryResult = await this.getMemory(groupId, options.messages, {
          maxFacts: CONFIG.maxMemories,
          centerNodeUuid: options.centerNodeUuid,
        });
        factsResult = { facts: memoryResult.facts || [], success: memoryResult.success };
      } else {
        const searchResult = await this.searchFacts(query, [groupId], {
          maxFacts: CONFIG.maxMemories,
        });
        factsResult = { facts: searchResult.facts || [], success: searchResult.success };
      }

      // Filter out invalid facts (temporal validity)
      const validFacts = (factsResult.facts || []).filter(
        (fact) => !fact.invalid_at
      );

      const results = validFacts.map((fact) => ({
        id: fact.uuid || `fact-${Date.now()}`,
        memory: fact.fact || fact.name || "",
        similarity: null as number | null,
        type: "fact" as const,
        createdAt: fact.created_at,
        validAt: fact.valid_at,
        sourceNode: fact.source_node_uuid,
        targetNode: fact.target_node_uuid,
      }));

      log("graphiti.searchMemories: success", {
        factsCount: validFacts.length,
        filteredInvalid: (factsResult.facts?.length || 0) - validFacts.length,
      });

      return {
        success: true as const,
        results,
        total: results.length,
        timing: 0,
        // Include raw facts and empty nodes for compatibility
        facts: validFacts,
        nodes: [] as GraphitiNodeResult[],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.searchMemories: error", { error: errorMessage });
      return {
        success: false as const,
        error: errorMessage,
        results: [],
        total: 0,
        timing: 0,
        facts: [],
        nodes: [],
      };
    }
  }

  /**
   * Get user profile (search for preferences)
   * Note: REST API doesn't have dedicated profile endpoint
   */
  async getProfile(userGroupId: string, query?: string) {
    log("graphiti.getProfile: start", { userGroupId });
    try {
      const searchQuery = query || "user preferences settings configuration";

      const factsResult = await this.searchFacts(searchQuery, [userGroupId], {
        maxFacts: CONFIG.maxProfileItems * 2,
      });

      const staticFacts: string[] = [];
      const dynamicFacts: string[] = [];

      for (const fact of factsResult.facts || []) {
        const content = fact.fact || fact.name || "";
        // Simple heuristic: facts without invalid_at are more "static"
        if (!fact.invalid_at) {
          staticFacts.push(content);
        } else {
          dynamicFacts.push(content);
        }
      }

      log("graphiti.getProfile: success", {
        staticCount: staticFacts.length,
        dynamicCount: dynamicFacts.length,
      });

      return {
        success: true as const,
        profile: {
          static: staticFacts.slice(0, CONFIG.maxProfileItems),
          dynamic: dynamicFacts.slice(0, CONFIG.maxProfileItems),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getProfile: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, profile: null };
    }
  }

  /**
   * List memories (episodes) for a group
   */
  async listMemories(groupId: string, limit = 20) {
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

  /**
   * Delete a memory (alias for deleteEpisode)
   */
  async deleteMemory(memoryId: string) {
    return this.deleteEpisode(memoryId);
  }

  /**
   * Compatibility method: searchNodes not available in REST API
   * Returns empty results
   */
  async searchNodes(
    query: string,
    groupIds: string[],
    options?: { maxNodes?: number; entityTypes?: string[] }
  ) {
    log("graphiti.searchNodes: REST API does not support node search", { groupIds });
    return {
      success: true as const,
      nodes: [] as GraphitiNodeResult[],
      total: 0,
    };
  }
}

export const graphitiRestClient = new GraphitiRestClient();
