export type MemoryScope = "user" | "project";

export type MemoryType =
  | "project-config"
  | "architecture"
  | "error-solution"
  | "preference"
  | "learned-pattern"
  | "conversation";

// Graphiti Entity Types (from Graphiti MCP Server)
export type GraphitiEntityType =
  | "Preference"
  | "Requirement"
  | "Procedure"
  | "Location"
  | "Event"
  | "Organization"
  | "Document"
  | "Topic"
  | "Object";

// Graphiti Node Result from search_nodes
export interface GraphitiNodeResult {
  uuid: string;
  name: string;
  labels?: string[];
  created_at?: string;
  summary?: string;
  group_id: string;
  attributes?: Record<string, unknown>;
}

// Graphiti Fact Result from search_memory_facts
export interface GraphitiFactResult {
  uuid?: string;
  name?: string;
  fact?: string;
  source_node_uuid?: string;
  target_node_uuid?: string;
  created_at?: string;
  valid_at?: string;
  invalid_at?: string;
  group_id?: string;
}

// Graphiti Episode Result from get_episodes
export interface GraphitiEpisodeResult {
  uuid: string;
  name: string;
  content?: string;
  created_at?: string;
  source?: string;
  source_description?: string;
  group_id: string;
}

// Unified memory result for context injection
export interface MemoryResult {
  id: string;
  memory?: string;
  similarity: number;
  type?: "node" | "fact" | "episode";
  labels?: string[];
  metadata?: Record<string, unknown>;
}

// Profile structure for user preferences
export interface UserProfile {
  static: string[];
  dynamic: string[];
}

// Conversation types for compatibility
export type ConversationRole = "user" | "assistant" | "system" | "tool";

export type ConversationContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } };

export interface ConversationToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ConversationMessage {
  role: ConversationRole;
  content: string | ConversationContentPart[];
  name?: string;
  tool_calls?: ConversationToolCall[];
  tool_call_id?: string;
}

export interface ConversationIngestResponse {
  id: string;
  conversationId: string;
  status: string;
}

// MCP Response types
export interface MCPSuccessResponse {
  message: string;
}

export interface MCPErrorResponse {
  error: string;
}

export interface MCPStatusResponse {
  status: "ok" | "error";
  message: string;
}
