import { CONFIG, GRAPHITI_MCP_URL, isConfigured } from "../config.js";
import { log } from "./logger.js";
import type {
  MemoryType,
  GraphitiNodeResult,
  GraphitiFactResult,
  GraphitiEpisodeResult,
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

  constructor() {
    this.baseUrl = GRAPHITI_MCP_URL || "http://localhost:8000/mcp/";
  }

  private async callMCPTool<T>(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const request: MCPRequest = {
      jsonrpc: "2.0",
      id: ++requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      } as MCPToolCallParams,
    };

    const response = await withTimeout(
      fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      }),
      TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = (await response.json()) as MCPResponse<T>;

    if (result.error) {
      throw new Error(`MCP Error: ${result.error.message}`);
    }

    return result.result as T;
  }

  async addMemory(
    content: string,
    groupId: string,
    metadata?: { type?: MemoryType; name?: string; uuid?: string; [key: string]: unknown }
  ) {
    log("graphiti.addMemory: start", { groupId, contentLength: content.length });
    try {
      const args: Record<string, unknown> = {
        name: metadata?.name || `Memory ${Date.now()}`,
        episode_body: content,
        group_id: groupId,
        source: "text",
        source_description: metadata?.type || "opencode-memory",
      };
      
      // Add optional uuid if provided
      if (metadata?.uuid) {
        args.uuid = metadata.uuid;
      }
      
      const result = await this.callMCPTool<{ message: string }>("add_memory", args);
      log("graphiti.addMemory: success", { message: result.message });
      return { success: true as const, message: result.message };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.addMemory: error", { error: errorMessage });
      return { success: false as const, error: errorMessage };
    }
  }

  async searchNodes(
    query: string,
    groupIds: string[],
    options?: { maxNodes?: number; entityTypes?: string[] }
  ) {
    log("graphiti.searchNodes: start", { groupIds, query: query.slice(0, 50) });
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
    log("graphiti.searchFacts: start", { groupIds, query: query.slice(0, 50) });
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
      log("graphiti.searchFacts: success", { count: result.facts?.length || 0 });
      return {
        success: true as const,
        facts: result.facts || [],
        total: result.facts?.length || 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.searchFacts: error", { error: errorMessage });
      return { success: false as const, error: errorMessage, facts: [], total: 0 };
    }
  }

  async getEpisodes(groupIds: string[], maxEpisodes?: number) {
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
      log("graphiti.getEntityEdge: success", { uuid });
      return { success: true as const, edge: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("graphiti.getEntityEdge: error", { uuid, error: errorMessage });
      return { success: false as const, error: errorMessage, edge: null };
    }
  }

  async clearGraph(groupIds?: string[]) {
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

  async searchMemories(query: string, groupId: string) {
    log("graphiti.searchMemories: start", { groupId });
    try {
      const [nodesResult, factsResult] = await Promise.all([
        this.searchNodes(query, [groupId], { 
          maxNodes: CONFIG.maxMemories,
          entityTypes: ["Preference", "Requirement", "Procedure"]
        }),
        this.searchFacts(query, [groupId], { maxFacts: CONFIG.maxMemories }),
      ]);

      // Combine results into a unified format compatible with existing context injection
      const results = [
        ...(nodesResult.nodes || []).map((node) => ({
          id: node.uuid,
          memory: node.summary || node.name,
          similarity: 0.9, // Graphiti doesn't return similarity scores directly
          type: "node" as const,
          labels: node.labels,
        })),
        ...(factsResult.facts || []).map((fact) => ({
          id: fact.uuid || `fact-${Date.now()}`,
          memory: fact.fact || fact.name,
          similarity: 0.85,
          type: "fact" as const,
        })),
      ];

      log("graphiti.searchMemories: success", { 
        nodesCount: nodesResult.nodes?.length || 0,
        factsCount: factsResult.facts?.length || 0,
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

  async getProfile(userGroupId: string, query?: string) {
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

  async deleteMemory(memoryId: string) {
    return this.deleteEpisode(memoryId);
  }
}

export const graphitiClient = new GraphitiClient();
