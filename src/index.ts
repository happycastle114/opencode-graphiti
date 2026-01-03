import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { graphitiClient as mcpClient } from "./services/graphiti-client.js";
import { graphitiRestClient as restClient } from "./services/graphiti-rest-client.js";
import { formatContextForPrompt } from "./services/context.js";
import { getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { createCompactionHook, type CompactionContext } from "./services/compaction.js";

import { isConfigured, CONFIG, USE_REST_API } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryScope, MemoryType } from "./types/index.js";

const graphitiClient = USE_REST_API ? restClient : mcpClient;

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

const MEMORY_KEYWORD_PATTERN =
  /\b(remember|memorize|save\s+this|note\s+this|keep\s+in\s+mind|don'?t\s+forget|learn\s+this|store\s+this|record\s+this|make\s+a\s+note|take\s+note|jot\s+down|commit\s+to\s+memory|remember\s+that|never\s+forget|always\s+remember)\b/i;

const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`graphiti\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function detectMemoryKeyword(text: string): boolean {
  const textWithoutCode = removeCodeBlocks(text);
  return MEMORY_KEYWORD_PATTERN.test(textWithoutCode);
}

export const GraphitiPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const tags = getTags(directory);
  const injectedSessions = new Set<string>();
  log("Plugin init", { directory, tags, configured: isConfigured() });

  if (!isConfigured()) {
    log("Plugin disabled - GRAPHITI_MCP_URL not set or server not reachable");
  }

  const compactionHook = isConfigured() && ctx.client
    ? createCompactionHook(ctx as CompactionContext, tags)
    : null;

  return {
    "chat.message": async (input, output) => {
      if (!isConfigured()) return;

      const start = Date.now();

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) {
          log("chat.message: no text parts found");
          return;
        }

        const userMessage = textParts.map((p) => p.text).join("\n");

        if (!userMessage.trim()) {
          log("chat.message: empty message, skipping");
          return;
        }

        log("chat.message: processing", {
          messagePreview: userMessage.slice(0, 100),
          partsCount: output.parts.length,
          textPartsCount: textParts.length,
        });

        if (detectMemoryKeyword(userMessage)) {
          log("chat.message: memory keyword detected");
          const nudgePart: Part = {
            id: `graphiti-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: MEMORY_NUDGE_MESSAGE,
            synthetic: true,
          };
          output.parts.push(nudgePart);
        }

        const isFirstMessage = !injectedSessions.has(input.sessionID);

        if (isFirstMessage) {
          injectedSessions.add(input.sessionID);

          const [profileResult, userMemoriesResult, projectMemoriesResult] = await Promise.all([
            graphitiClient.getProfile(tags.user, userMessage),
            graphitiClient.searchMemories(userMessage, tags.user),
            graphitiClient.searchMemories(userMessage, tags.project),
          ]);

          const profile = profileResult.success ? profileResult : null;
          const userMemories = userMemoriesResult.success ? userMemoriesResult : { results: [] };
          const projectMemories = projectMemoriesResult.success ? projectMemoriesResult : { results: [] };

          const memoryContext = formatContextForPrompt(
            profile,
            userMemories,
            projectMemories
          );

          if (memoryContext) {
            const contextPart: Part = {
              id: `graphiti-context-${Date.now()}`,
              sessionID: input.sessionID,
              messageID: output.message.id,
              type: "text",
              text: memoryContext,
              synthetic: true,
            };

            output.parts.unshift(contextPart);

            const duration = Date.now() - start;
            log("chat.message: context injected", {
              duration,
              contextLength: memoryContext.length,
            });
          }
        }

      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },

    tool: {
      graphiti: tool({
        description:
          "Manage Graphiti temporal knowledge graph. Features: entity extraction, fact relationships with validity tracking, multiple data formats (text/json/message). Use 'search' for semantic+graph search, 'add' to store (auto-detects JSON), 'graph' to explore entity relationships.",
        args: {
          mode: tool.schema
            .enum(["add", "search", "profile", "list", "forget", "graph", "help", "status"])
            .optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          type: tool.schema
            .enum([
              "project-config",
              "architecture",
              "error-solution",
              "preference",
              "learned-pattern",
              "conversation",
            ])
            .optional(),
          scope: tool.schema.enum(["user", "project"]).optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          source: tool.schema.enum(["text", "json", "message"]).optional(),
          entityTypes: tool.schema.array(tool.schema.string()).optional(),
          centerNodeId: tool.schema.string().optional(),
        },
        async execute(args: {
          mode?: string;
          content?: string;
          query?: string;
          type?: MemoryType;
          scope?: MemoryScope;
          memoryId?: string;
          limit?: number;
          source?: "text" | "json" | "message";
          entityTypes?: string[];
          centerNodeId?: string;
        }) {
          if (!isConfigured()) {
            return JSON.stringify({
              success: false,
              error:
                "GRAPHITI_MCP_URL not set. Set it in your environment or run docker compose up in graphiti/mcp_server.",
            });
          }

          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help": {
                return JSON.stringify({
                  success: true,
                  message: "Graphiti Temporal Knowledge Graph - Usage Guide",
                  features: [
                    "Temporal validity tracking (facts can be superseded)",
                    "Entity extraction (Preference, Requirement, Procedure, etc.)",
                    "Graph relationships between entities",
                    "Multiple data formats (text, json, message)",
                  ],
                  commands: [
                    {
                      command: "add",
                      description: "Store memory (auto-detects JSON)",
                      args: ["content", "type?", "scope?", "source?"],
                    },
                    {
                      command: "search",
                      description: "Semantic + graph search",
                      args: ["query", "scope?", "centerNodeId?"],
                    },
                    {
                      command: "graph",
                      description: "Explore entity relationships",
                      args: ["centerNodeId", "query?", "scope?"],
                    },
                    {
                      command: "profile",
                      description: "View user preferences",
                      args: ["query?"],
                    },
                    {
                      command: "list",
                      description: "List recent episodes",
                      args: ["scope?", "limit?"],
                    },
                    {
                      command: "forget",
                      description: "Remove a memory",
                      args: ["memoryId"],
                    },
                    {
                      command: "status",
                      description: "Check Graphiti server status",
                      args: [],
                    },
                  ],
                  sources: {
                    text: "Plain text (default)",
                    json: "Structured data - entities auto-extracted",
                    message: "Conversation format",
                  },
                  entityTypes: CONFIG.entityTypes,
                });
              }

              case "status": {
                const result = await graphitiClient.getStatus();
                return JSON.stringify(result);
              }

              case "add": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for add mode",
                  });
                }

                const sanitizedContent = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content)) {
                  return JSON.stringify({
                    success: false,
                    error: "Cannot store fully private content",
                  });
                }

                const scope = args.scope || "project";
                const groupId =
                  scope === "user" ? tags.user : tags.project;

                const result = await graphitiClient.addMemory(
                  sanitizedContent,
                  groupId,
                  { 
                    type: args.type, 
                    name: `${args.type || "memory"}-${Date.now()}`,
                    source: args.source,
                  }
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to add memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: `Memory added to ${scope} scope (source: ${args.source || "auto-detected"})`,
                  scope,
                  type: args.type,
                });
              }

              case "search": {
                if (!args.query) {
                  return JSON.stringify({
                    success: false,
                    error: "query parameter is required for search mode",
                  });
                }

                const searchOptions = { centerNodeUuid: args.centerNodeId };
                const scope = args.scope;

                if (scope === "user") {
                  const result = await graphitiClient.searchMemories(
                    args.query,
                    tags.user,
                    searchOptions
                  );
                  if (!result.success) {
                    return JSON.stringify({
                      success: false,
                      error: result.error || "Failed to search memories",
                    });
                  }
                  return formatSearchResults(args.query, scope, result, args.limit);
                }

                if (scope === "project") {
                  const result = await graphitiClient.searchMemories(
                    args.query,
                    tags.project,
                    searchOptions
                  );
                  if (!result.success) {
                    return JSON.stringify({
                      success: false,
                      error: result.error || "Failed to search memories",
                    });
                  }
                  return formatSearchResults(args.query, scope, result, args.limit);
                }

                const [userResult, projectResult] = await Promise.all([
                  graphitiClient.searchMemories(args.query, tags.user, searchOptions),
                  graphitiClient.searchMemories(args.query, tags.project, searchOptions),
                ]);

                if (!userResult.success || !projectResult.success) {
                  return JSON.stringify({
                    success: false,
                    error: userResult.error || projectResult.error || "Failed to search memories",
                  });
                }

                const combined = [
                  ...(userResult.results || []).map((r) => ({
                    ...r,
                    scope: "user" as const,
                  })),
                  ...(projectResult.results || []).map((r) => ({
                    ...r,
                    scope: "project" as const,
                  })),
                ].sort((a, b) => b.similarity - a.similarity);

                return JSON.stringify({
                  success: true,
                  query: args.query,
                  count: combined.length,
                  results: combined.slice(0, args.limit || 10).map((r) => ({
                    id: r.id,
                    content: r.memory,
                    similarity: Math.round(r.similarity * 100),
                    scope: r.scope,
                    type: r.type,
                    labels: "labels" in r ? r.labels : undefined,
                    createdAt: r.createdAt,
                  })),
                });
              }

              case "graph": {
                if (!args.centerNodeId) {
                  return JSON.stringify({
                    success: false,
                    error: "centerNodeId is required for graph mode. First use 'search' to find a node ID.",
                  });
                }

                const scope = args.scope || "project";
                const groupId = scope === "user" ? tags.user : tags.project;
                
                const factsResult = await graphitiClient.searchFacts(
                  args.query || "",
                  [groupId],
                  { 
                    maxFacts: args.limit || 20,
                    centerNodeUuid: args.centerNodeId,
                  }
                );

                if (!factsResult.success) {
                  return JSON.stringify({
                    success: false,
                    error: factsResult.error || "Failed to explore graph",
                  });
                }

                const validFacts = (factsResult.facts || []).filter((f) => !f.invalid_at);
                const invalidFacts = (factsResult.facts || []).filter((f) => f.invalid_at);

                return JSON.stringify({
                  success: true,
                  centerNodeId: args.centerNodeId,
                  relationships: {
                    valid: validFacts.map((f) => ({
                      id: f.uuid,
                      fact: f.fact || f.name,
                      sourceNode: f.source_node_uuid,
                      targetNode: f.target_node_uuid,
                      validAt: f.valid_at,
                    })),
                    superseded: invalidFacts.map((f) => ({
                      id: f.uuid,
                      fact: f.fact || f.name,
                      invalidAt: f.invalid_at,
                    })),
                  },
                  summary: `Found ${validFacts.length} valid and ${invalidFacts.length} superseded facts`,
                });
              }

              case "profile": {
                const result = await graphitiClient.getProfile(
                  tags.user,
                  args.query
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to fetch profile",
                  });
                }

                return JSON.stringify({
                  success: true,
                  profile: {
                    static: result.profile?.static || [],
                    dynamic: result.profile?.dynamic || [],
                  },
                });
              }

              case "list": {
                const scope = args.scope || "project";
                const limit = args.limit || 20;
                const groupId =
                  scope === "user" ? tags.user : tags.project;

                const result = await graphitiClient.listMemories(
                  groupId,
                  limit
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to list memories",
                  });
                }

                const memories = result.memories || [];
                return JSON.stringify({
                  success: true,
                  scope,
                  count: memories.length,
                  memories: memories.map((m) => ({
                    id: m.id,
                    content: m.summary,
                    createdAt: m.createdAt,
                    metadata: m.metadata,
                  })),
                });
              }

              case "forget": {
                if (!args.memoryId) {
                  return JSON.stringify({
                    success: false,
                    error: "memoryId parameter is required for forget mode",
                  });
                }

                const scope = args.scope || "project";

                const result = await graphitiClient.deleteMemory(
                  args.memoryId
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to delete memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: `Memory ${args.memoryId} removed from ${scope} scope`,
                });
              }

              default:
                return JSON.stringify({
                  success: false,
                  error: `Unknown mode: ${mode}`,
                });
            }
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      if (compactionHook) {
        await compactionHook.event(input);
      }
    },
  };
};

export const SupermemoryPlugin = GraphitiPlugin;

export { graphitiClient as graphitiMcpClient, GraphitiClient } from "./services/graphiti-client.js";
export { graphitiRestClient, GraphitiRestClient } from "./services/graphiti-rest-client.js";

const activeClient = USE_REST_API ? restClient : mcpClient;
export { activeClient as graphitiClient };

export type { MemoryScope, MemoryType, GraphitiNodeResult, GraphitiFactResult, GraphitiEpisodeResult, MemoryResult, UserProfile } from "./types/index.js";

export { isConfigured, CONFIG, GRAPHITI_MCP_URL, GRAPHITI_REST_URL, USE_REST_API } from "./config.js";

function formatSearchResults(
  query: string,
  scope: string | undefined,
  results: { results?: Array<{ id: string; memory?: string; similarity: number; type?: string }> },
  limit?: number
): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    scope,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r) => ({
      id: r.id,
      content: r.memory,
      similarity: Math.round(r.similarity * 100),
      type: r.type,
    })),
  });
}
