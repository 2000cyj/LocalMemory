# LocalMemory

> **mem0-style memory engine for Node.js + SQLite.** LLM-driven fact extraction, semantic deduplication, multi-signal recall with optional rerank. Ships with built-in **MCP server (HTTP + stdio)** for AI agent integration.

A lightweight memory layer for AI agents and applications. Single SQLite file, no external vector database.

## Install

```bash
npm install localmemory
```

Requires Node.js ≥ 20.

---

## Option 1 — Use as a library (in-process)

Best when your agent runs in the same Node process.

```ts
import { LongMemory, openai_llm, openai_embedding } from 'localmemory';

const memory = new LongMemory({
  db_path: './memory.db',
  llm: openai_llm({
    api_key: process.env.OPENAI_API_KEY!,
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  }),
  embedding: openai_embedding({
    api_key: process.env.OPENAI_API_KEY!,
    base_url: 'https://api.openai.com/v1',
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536,
  }),
  default_scope: { user_id: 'alice' },
});

// Add memories (4-step mem0 pipeline runs automatically)
await memory.add('Alice prefers TypeScript for backend work.');

// Search (4-signal recall + LLM semantic filter, returns top K)
const results = await memory.search({
  query: 'user preferences',
  scope: { user_id: 'alice' },
  top_k: 5,
});

memory.close();
```

---

## Option 2 — Run as MCP server (for external agents)

Two transports supported:

### HTTP transport (default)

```bash
# Set API key
export LONGMEMORY_OPENAI_API_KEY=sk-...

# Launch (server listens on :7331/mcp)
npx localmemory-mcp
# Output: [localmemory-mcp] listening on http://127.0.0.1:7331/mcp
```

### stdio transport (recommended for local agents)

```bash
npx localmemory-mcp-stdio
```

Agent launches this as a child process — no port needed.

### Configure your MCP client (HTTP)

```json
{
  "mcpServers": {
    "localmemory": {
      "url": "http://127.0.0.1:7331/mcp"
    }
  }
}
```

### Configure your MCP client (stdio)

```json
{
  "mcpServers": {
    "localmemory": {
      "command": "npx",
      "args": ["localmemory-mcp-stdio"]
    }
  }
}
```

### 5 MCP tools exposed

| Tool | Description |
|------|-------------|
| `longmemory_add` | Extract facts (LLM) → dedup (LLM) → embed → store |
| `longmemory_search` | Query rewrite (LLM) → 4-signal RRF → LLM re-rank top K |
| `longmemory_get` | Fetch a single memory by id |
| `longmemory_list` | List memory ids in a scope |
| `longmemory_delete` | Delete a memory by id |

Plus 1 resource: `localmemory://status`

---

## Bring your own LLM

The engine needs 5 LLM methods. Default provider works with any OpenAI-compatible endpoint:

```ts
import { openai_llm, openai_embedding, aliyun_embedding } from 'localmemory/providers';

// OpenAI
const llm = openai_llm({
  api_key: process.env.OPENAI_API_KEY!,
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini',
});

// Alibaba Bailian (for embedding — uses custom body format)
const embedding = aliyun_embedding({
  api_key: process.env.ALIYUN_KEY!,
  base_url: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
  embedding_model: 'text-embedding-v3',
  dimensions: 1024,
});
```

Works with OpenAI, Azure, Ollama, vLLM, MiniMax, Aliyun Bailian, etc.

---

## Architecture

### Storage (3-table SQLite schema)

```sql
memories       -- content + embedding BLOB + scope columns + timestamps + access_count
entities       -- named entities extracted from memories
memory_entities -- many-to-many link
memory_entities_fts -- FTS5 virtual table for BM25 keyword search
```

### Ingest pipeline (4 steps, LLM at every step)

```
raw text
  → [1] LLM fact_extractor ──── 抽原子事实(LLM)
  → [2] LLM deduplicator ─────── vs 已有记忆判重(LLM)
  → [3] Embedding API ───────── 向量化
  → [4] LLM entity_extractor ── 抽实体名(LLM)
  → [5] Storage ───────────── SQLite 写入
```

**LLM calls: 3 per fact added**

### Search pipeline (5 steps, 1 LLM call per query)

```
original query
  → [1] LLM query_rewriter ──── 拆解子意图(变体)
  → [2] 4 signals (no LLM) ──── semantic + BM25 + entity + temporal
  → [3] RRF fusion ──────────── 按 fused_score 降序
  → [4] LLM rerank ─────────── 看 top RERANK_DEPTH,挑 top K 按相关性排
  → [5] Return top K (LLM 排序)
```

**LLM calls: 2 per query** (rewrite + rerank)

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `LONGMEMORY_OPENAI_API_KEY` | (required) | OpenAI-compatible API key |
| `LONGMEMORY_OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL |
| `LONGMEMORY_MODEL` | `gpt-4.1-mini` | Chat model |
| `LONGMEMORY_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `LONGMEMORY_EMBEDDING_DIM` | `1536` | Embedding dimensions |
| `LONGMEMORY_LLM_MODEL` | (overrides MODEL for LLM) | LLM-specific model name |
| `LONGMEMORY_LLM_BASE_URL` | (overrides OPENAI_BASE_URL for LLM) | LLM-specific base URL |
| `LONGMEMORY_LLM_API_KEY` | (overrides OPENAI_API_KEY for LLM) | LLM-specific key |
| `LONGMEMORY_DB_PATH` | `./localmemory.db` | SQLite file |
| `LONGMEMORY_MCP_PORT` | `7331` | HTTP server port |
| `LONGMEMORY_MCP_HOST` | `127.0.0.1` | HTTP bind address |
| `LONGMEMORY_RERANK_DEPTH` | `30` | LLM rerank candidate pool |

See `.env.example` for full config with presets (OpenAI, MiniMax, Aliyun Bailian, Ollama, vLLM).

---

## API

### `LongMemory` class (library)

```ts
class LongMemory {
  add(text: string, options?: { scope?, metadata?, source? }): Promise<{ added, skipped }>
  search(query: { query, scope?, top_k?, filters? }): Promise<search_result[]>
  get(id: string): stored_memory | null
  delete(id: string): void
  list(scope?: scope, limit?: number): string[]
  status(): { ready, memory_count, entity_count, store_kind }
  close(): void
}
```

---

## Measured accuracy (239-memory mixed benchmark)

| query type | precision@K | notes |
|-----------|-------------|-------|
| 测试工具 | 100% | top 3 都是相关 |
| 代码规范 | 100% | top 3 都是相关 |
| PR 合并 | 67% | LLM 偶尔把"Prisma ORM"误判相关 |
| CI 配置 | 100% | top 3 都是相关 |
| 覆盖率 | 100% | top 3 都是相关 |
| 9/10 queries | 100% precision | |

**Avg query time: 210ms**

---

## License

MIT