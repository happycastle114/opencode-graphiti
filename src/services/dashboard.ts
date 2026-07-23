import { createServer, type Server } from "node:http";
import { graphitiClient as mcpClient } from "./graphiti-client.js";
import { graphitiRestClient as restClient } from "./graphiti-rest-client.js";
import { listReplaySummaries, loadReplayTimeline, type ReplaySummary, type ReplayTimeline } from "./replay.js";
import { CONFIG, USE_REST_API } from "../config.js";
import { getTags } from "./tags.js";

interface DashboardMemory {
  id: string;
  summary: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardClient {
  getStatus(): Promise<{ success: boolean; status: string; message?: string }>;
  getProfile(
    userGroupId: string,
    query?: string,
  ): Promise<{ success: boolean; profile: { static: string[]; dynamic: string[] } | null }>;
  listMemories(
    groupId: string,
    limit?: number,
  ): Promise<{ success: boolean; memories: DashboardMemory[] }>;
}

export interface DashboardDependencies {
  tags: { user: string; project: string };
  client: DashboardClient;
  listReplays: () => ReplaySummary[];
  loadReplay: (sessionId: string) => ReplayTimeline | null;
}

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src 'self'; img-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" },
  });
}

function documentResponse(): Response {
  return new Response(renderDashboardDocument(), {
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8" },
  });
}

async function loadOverview(dependencies: DashboardDependencies) {
  const [statusResult, profileResult, projectResult, userResult] = await Promise.all([
    dependencies.client.getStatus(),
    dependencies.client.getProfile(
      dependencies.tags.user,
      "user communication response coding style preferences",
    ),
    dependencies.client.listMemories(dependencies.tags.project, CONFIG.maxProjectMemories),
    dependencies.client.listMemories(dependencies.tags.user, CONFIG.maxMemories),
  ]);

  return {
    status: statusResult.success ? statusResult.status : "error",
    statusMessage: statusResult.message ?? "Graphiti status unavailable",
    profile: profileResult.success && profileResult.profile
      ? profileResult.profile
      : { static: [], dynamic: [] },
    profileError: !profileResult.success,
    projectMemories: projectResult.success ? projectResult.memories : [],
    projectMemoriesError: !projectResult.success,
    userMemories: userResult.success ? userResult.memories : [],
    userMemoriesError: !userResult.success,
    replays: dependencies.listReplays(),
  };
}

export function createDashboardHandler(dependencies: DashboardDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...SECURITY_HEADERS, allow: "GET" },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/") return documentResponse();
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    if (url.pathname === "/api/overview") return json(await loadOverview(dependencies));

    const replayMatch = /^\/api\/replays\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (replayMatch?.[1]) {
      const timeline = dependencies.loadReplay(replayMatch[1]);
      return timeline ? json(timeline) : json({ error: "Replay not found" }, 404);
    }

    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  };
}

function isAllowedLoopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

async function writeNodeResponse(serverResponse: import("node:http").ServerResponse, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries());
  serverResponse.writeHead(response.status, headers);
  serverResponse.end(await response.text());
}

export async function startDashboard(options: { directory: string; port: number }): Promise<{ url: string; stop: () => void }> {
  const client = (USE_REST_API ? restClient : mcpClient) as DashboardClient;
  const handler = createDashboardHandler({
    tags: getTags(options.directory),
    client,
    listReplays: listReplaySummaries,
    loadReplay: loadReplayTimeline,
  });

  const server = createServer(async (request, response) => {
    if (!isAllowedLoopbackHost(request.headers.host, options.port)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden host");
      return;
    }

    const url = `http://127.0.0.1:${options.port}${request.url ?? "/"}`;
    try {
      await writeNodeResponse(response, await handler(new Request(url, { method: request.method })));
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("Dashboard request failed");
    }
  });

  await listenOnLoopback(server, options.port);
  return {
    url: `http://127.0.0.1:${options.port}`,
    stop: () => server.close(),
  };
}

function listenOnLoopback(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function renderDashboardDocument(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Local Graphiti memory dashboard">
  <title>Graphiti Memory</title>
  <style>
    :root { --surface-primary:#0b1020; --surface-secondary:#121a2c; --surface-elevated:#19233a; --text-primary:#eef4ff; --text-secondary:#aab8d2; --text-tertiary:#71809b; --border-default:#2b3853; --accent-primary:#6ee7c7; --accent-hover:#9af5dd; --status-success:#6ee7c7; --status-warning:#f4c97b; --status-error:#ff9b9b; --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px; --space-6:24px; --space-8:32px; color-scheme:dark; }
    * { box-sizing:border-box; }
    body { margin:0; min-block-size:100dvb; background:var(--surface-primary); color:var(--text-primary); font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size:14px; line-height:1.55; }
    button,input { font:inherit; }
    button { color:inherit; }
    .shell { max-inline-size:1200px; margin-inline:auto; padding:var(--space-6); }
    .header { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--space-4); margin-block-end:var(--space-8); }
    h1 { margin:0; font-size:28px; line-height:1.2; } h2 { margin:0; font-size:18px; font-weight:650; line-height:1.3; } p { margin:0; }
    .subtitle { color:var(--text-secondary); margin-block-start:var(--space-2); }
    .status { border:1px solid var(--border-default); border-radius:999px; padding:var(--space-2) var(--space-3); color:var(--status-success); font-size:12px; font-weight:600; white-space:nowrap; }
    .status[data-state="error"] { color:var(--status-error); } .status[data-state="warning"] { color:var(--status-warning); }
    .grid { display:grid; gap:var(--space-4); grid-template-columns:repeat(2,minmax(0,1fr)); }
    .panel { min-inline-size:0; border:1px solid var(--border-default); border-radius:8px; background:var(--surface-secondary); padding:var(--space-5); }
    .panel-heading { display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); margin-block-end:var(--space-4); }
    .list { display:grid; gap:var(--space-2); margin:0; padding:0; list-style:none; }
    .item { min-inline-size:0; overflow-wrap:break-word; word-break:normal; border:1px solid var(--border-default); border-radius:6px; background:var(--surface-elevated); padding:var(--space-3); }
    .meta { color:var(--text-tertiary); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12px; margin-block-start:var(--space-1); }
    .filter { inline-size:100%; border:1px solid var(--border-default); border-radius:6px; background:var(--surface-primary); color:var(--text-primary); padding:var(--space-3); }
    .filter:focus-visible,.replay-button:focus-visible { outline:2px solid var(--accent-primary); outline-offset:2px; }
    .replay-button { inline-size:100%; cursor:pointer; text-align:start; border:1px solid var(--border-default); border-radius:6px; background:var(--surface-elevated); padding:var(--space-3); transition:background-color 150ms ease-out,color 150ms ease-out; }
    .replay-button[data-selected="true"] { border-color:var(--accent-primary); color:var(--accent-hover); }
    .replay-button:hover { color:var(--accent-hover); } .replay-button:active { background:var(--surface-primary); }
    .empty { color:var(--text-secondary); } .role { color:var(--accent-primary); font-size:12px; font-weight:700; text-transform:uppercase; }
    @media (max-width: 767px) { .grid { grid-template-columns:1fr; } }
    @media (max-width: 640px) { .shell { padding:var(--space-4); } .header { flex-direction:column; } }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { transition:none !important; } }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header"><div><h1>Graphiti Memory</h1><p class="subtitle">Local, read-only inspection of durable context and replayed sessions.</p></div><span id="status" class="status" data-state="warning">Loading</span></header>
    <section class="panel" aria-labelledby="search-title"><div class="panel-heading"><h2 id="search-title">Memory filter</h2><span id="result-count" class="meta" aria-live="polite" aria-atomic="true"></span></div><label class="meta" for="memory-filter">Filter loaded memories</label><input id="memory-filter" class="filter" type="search" placeholder="Search visible memory" autocomplete="off"></section>
    <section class="grid" aria-label="Memory overview"><article class="panel"><div class="panel-heading"><h2>User profile</h2></div><ul id="profile" class="list"><li class="empty">Loading profile…</li></ul></article><article class="panel"><div class="panel-heading"><h2>Project knowledge</h2></div><ul id="project-memories" class="list"><li class="empty">Loading project memories…</li></ul></article><article class="panel"><div class="panel-heading"><h2>User memories</h2></div><ul id="user-memories" class="list"><li class="empty">Loading user memories…</li></ul></article><article class="panel"><div class="panel-heading"><h2>Replay sessions</h2></div><div id="replays" class="list"><p class="empty">Loading replay sessions…</p></div></article></section>
    <section class="panel" aria-labelledby="timeline-title" style="margin-block-start:var(--space-4)"><div class="panel-heading"><h2 id="timeline-title">Replay timeline</h2><span id="timeline-session" class="meta"></span></div><ol id="timeline" class="list"><li class="empty">Select a replay session to inspect its sanitized timeline.</li></ol></section>
  </main>
  <script>
    const $ = (selector) => document.querySelector(selector);
    const memoryRows = [];
    let replaySummaries = [];
    let selectedReplayId = '';
    const empty = (text) => { const item = document.createElement('li'); item.className = 'empty'; item.textContent = text; return item; };
    const row = (text, meta) => { const item = document.createElement('li'); item.className = 'item'; const content = document.createElement('div'); content.textContent = text; item.append(content); if (meta) { const detail = document.createElement('div'); detail.className = 'meta'; detail.textContent = meta; item.append(detail); } return item; };
    function renderMemories(target, memories, unavailable) { target.replaceChildren(); if (unavailable) { target.append(empty('Memory source is unavailable.')); return; } if (!memories.length) { target.append(empty('No memories available.')); return; } for (const memory of memories) { const item = row(memory.summary, memory.createdAt || memory.id); item.dataset.filter = memory.summary.toLowerCase(); target.append(item); memoryRows.push(item); } }
    function renderProfile(profile, unavailable) { const target = $('#profile'); target.replaceChildren(); if (unavailable) { target.append(empty('Profile source is unavailable.')); return; } const entries = [...profile.static.map(value => ['Stable', value]), ...profile.dynamic.map(value => ['Recent', value])]; if (!entries.length) { target.append(empty('No profile facts available.')); return; } for (const [kind, value] of entries) target.append(row(value, kind)); }
    async function selectReplay(sessionId) { selectedReplayId = sessionId; renderReplays(replaySummaries); const timeline = $('#timeline'); timeline.replaceChildren(empty('Loading replay timeline...')); try { const response = await fetch('/api/replays/' + encodeURIComponent(sessionId)); if (!response.ok) throw new Error('replay unavailable'); const replay = await response.json(); if (sessionId !== selectedReplayId) return; $('#timeline-session').textContent = replay.sessionId; timeline.replaceChildren(); if (!replay.events.length) { timeline.append(empty('This replay has no displayable text events.')); return; } for (const event of replay.events) { const item = row(event.content, event.role + ' · ' + event.at); const label = document.createElement('div'); label.className = 'role'; label.textContent = event.role; item.prepend(label); timeline.append(item); } } catch { if (sessionId !== selectedReplayId) return; timeline.replaceChildren(empty('Replay is unavailable.')); } }
    function renderReplays(replays) { replaySummaries = replays; const target = $('#replays'); target.replaceChildren(); if (!replays.length) { target.append(empty('No recorded replay sessions yet.')); return; } for (const replay of replays) { const button = document.createElement('button'); button.className = 'replay-button'; button.type = 'button'; button.dataset.selected = String(replay.sessionId === selectedReplayId); button.setAttribute('aria-pressed', String(replay.sessionId === selectedReplayId)); button.textContent = replay.sessionId; const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = replay.eventCount + ' events · ' + replay.updatedAt; button.append(meta); button.addEventListener('click', () => selectReplay(replay.sessionId)); target.append(button); } }
    $('#memory-filter').addEventListener('input', (event) => { const query = event.target.value.toLowerCase().trim(); let visible = 0; for (const item of memoryRows) { const match = !query || item.dataset.filter.includes(query); item.hidden = !match; if (match) visible++; } $('#result-count').textContent = query ? visible + ' matching' : ''; });
    async function load() { try { const response = await fetch('/api/overview'); if (!response.ok) throw new Error('overview failed'); const data = await response.json(); const status = $('#status'); status.textContent = data.statusMessage; status.dataset.state = data.status === 'ok' ? 'ok' : 'error'; renderProfile(data.profile, data.profileError); renderMemories($('#project-memories'), data.projectMemories, data.projectMemoriesError); renderMemories($('#user-memories'), data.userMemories, data.userMemoriesError); renderReplays(data.replays); } catch { $('#status').textContent = 'Dashboard data unavailable'; $('#status').dataset.state = 'error'; $('#profile').replaceChildren(empty('Profile source is unavailable.')); $('#project-memories').replaceChildren(empty('Memory source is unavailable.')); $('#user-memories').replaceChildren(empty('Memory source is unavailable.')); $('#replays').replaceChildren(empty('Replay source is unavailable.')); } }
    load();
  </script>
</body>
</html>`;
}
