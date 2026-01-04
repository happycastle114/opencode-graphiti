# opencode-graphiti

OpenCode plugin that gives coding agents **persistent memory** using [Graphiti](https://github.com/getzep/graphiti) temporal knowledge graph.

This is a fork of [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) that uses Graphiti MCP Server as the backend instead of Supermemory.

## Features

- **Automatic Context Injection**: User profile + project knowledge + relevant memories injected at session start
- **Temporal Knowledge Graph**: Graphiti tracks relationships, entities, and changes over time
- **Multi-Tenant Scoping**: User-scope and project-scope memory isolation via `group_id`
- **"Remember" Trigger Detection**: Automatically prompts agent to save when user says "remember this"
- **Context Compaction**: Saves session summaries before context window limits
- **Hybrid Search**: Semantic + keyword search via Graphiti MCP Server

## Architecture

```
┌──────────────────────┐     ┌─────────────────────────────────────┐
│   OpenCode Agent     │     │      Graphiti MCP Server            │
│                      │     │                                     │
│  ┌────────────────┐  │     │  ┌───────────────┐                  │
│  │opencode-graphiti│─┼─────┼─▶│   MCP Tools   │                  │
│  │    (plugin)    │  │HTTP │  │ (add_memory,  │                  │
│  └────────────────┘  │     │  │  search_nodes)│                  │
│                      │     │  └───────┬───────┘                  │
│  No API keys needed  │     │          │                          │
│  Just HTTP calls     │     │  ┌───────▼───────┐  ┌────────────┐  │
└──────────────────────┘     │  │   Graphiti    │  │ OpenAI API │  │
                             │  │ (Knowledge    │──│ (Embedding │  │
                             │  │   Graph)      │  │  + LLM)    │  │
                             │  └───────┬───────┘  └────────────┘  │
                             │          │                          │
                             │  ┌───────▼───────┐                  │
                             │  │   FalkorDB    │                  │
                             │  └───────────────┘                  │
                             └─────────────────────────────────────┘
```


## Quick Start

### 1. Start Graphiti MCP Server

```bash
git clone https://github.com/getzep/graphiti.git
cd graphiti/mcp_server

cp .env.example .env

docker compose up -d
```

### 2. Install the Plugin

```bash
bunx opencode-graphiti@latest install
```

Or manually add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-graphiti@latest"]
}
```

### 3. Configure (Optional)

Create `~/.config/opencode/graphiti.jsonc`:

```jsonc
{
  // Graphiti MCP Server URL (기본값)
  "mcpUrl": "http://localhost:8000/mcp/",
  
  // Group ID prefix
  "groupIdPrefix": "opencode",
  
  // Search limits
  "maxMemories": 5,
  "maxProjectMemories": 10
}
```

Or use environment variable:

```bash
export GRAPHITI_MCP_URL="http://localhost:8000/mcp/"
```

### 4. Initialize Memory

Start OpenCode and run:

```
/graphiti-init
```

## Usage

### Automatic Features

- **First message**: Profile + project memories + relevant context injected
- **"Remember" triggers**: Agent prompted to save when you say "remember", "save this", etc.
- **Session compaction**: Summaries saved to memory before context limits

### Manual Tool Usage

```
graphiti(mode: "add", content: "Uses Bun for package management", type: "project-config", scope: "project")
graphiti(mode: "search", query: "testing patterns")
graphiti(mode: "list", scope: "project", limit: 20)
graphiti(mode: "profile")
graphiti(mode: "forget", memoryId: "uuid-here")
graphiti(mode: "status")
```

### Memory Scopes

| Scope | Description | Use For |
|-------|-------------|---------|
| `user` | Cross-project | Personal preferences, coding style |
| `project` | This repo only | Build commands, architecture, conventions |

### Memory Types

- `project-config` - Tech stack, commands, tooling
- `architecture` - Codebase structure, data flow
- `learned-pattern` - Project-specific conventions
- `error-solution` - Known issues and fixes
- `preference` - Coding style preferences
- `conversation` - Session summaries

## Requirements

- OpenCode 1.0+
- Graphiti MCP Server running (provides its own LLM/embedding)

## Troubleshooting

### Plugin not loading

Check logs at `~/.opencode-graphiti.log`

### Connection errors

Verify Graphiti is running:

```bash
curl http://localhost:8000/health
```

## License

MIT

## Credits

- Original [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) by Supermemory
- [Graphiti](https://github.com/getzep/graphiti) by Zep
