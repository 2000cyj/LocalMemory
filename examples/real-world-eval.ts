/*
*  file  : examples/real-world-eval.ts
*  usage : Insert REAL data into the REAL database, query from REAL DB.
*          Demonstrates full pipeline end-to-end.
*
*          Uses .env config (MiniMax M3 + Aliyun qwen3.7 embedding).
*
*  Run:
*    npx tsx examples/real-world-eval.ts
*/

import { readFileSync } from 'node:fs';

function load_env(path = '.env'): void {
    try {
        const text = readFileSync(path, 'utf-8');
        for (const line of text.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !line.trim().startsWith('#')) {
                const key = m[1];
                let val = m[2];
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (process.env[key] === undefined) process.env[key] = val;
            }
        }
    } catch { /* no .env */ }
}
load_env();

import { LongMemory, openai_llm, openai_embedding } from '../dist/index.js';

const LLM_BASE = process.env.LONGMEMORY_LLM_BASE_URL ?? 'https://api.minimaxi.com/v1';
const EMB_BASE = process.env.LONGMEMORY_OPENAI_BASE_URL
    ?? 'https://ws-j43vcnj1hzb385je.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

const memory = new LongMemory({
    db_path: './real-world.db',  // ← 真实数据库(不是 test db)
    llm: openai_llm({
        api_key: process.env.LONGMEMORY_LLM_API_KEY!,
        base_url: LLM_BASE,
        model: process.env.LONGMEMORY_MODEL ?? 'MiniMax-M3',
    }),
    embedding: openai_embedding({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY!,
        base_url: EMB_BASE,
        embedding_model: process.env.LONGMEMORY_EMBEDDING_MODEL ?? 'qwen3.7-text-embedding',
        embedding_dimensions: Number(process.env.LONGMEMORY_EMBEDDING_DIM ?? 1024),
    }),
});

// ── 真实项目场景: 多 agent 共享记忆,场景是个 AI 项目 ──────────
const ITEMS = [
    // 用户偏好 (3 条)
    '阿亮喜欢用 TypeScript 写后端',
    '阿亮偏好 PostgreSQL 做主存储',
    '阿亮对 Vim 编辑器有偏好',

    // 技术栈 (4 条)
    '项目后端用 TypeScript + Fastify 框架',
    '数据库用 PostgreSQL 15,Prisma 作 ORM',
    '前端是 React 18 + Vite',
    '部署用 Docker + GitHub Actions',

    // 项目决策 (3 条)
    '决定不用 MongoDB 因为需要强事务',
    '选 Fastify 而不是 Express 因为性能更好',
    '不用 microservices 保持单体架构简单',

    // 团队 (3 条)
    '阿亮负责后端和数据库',
    '小李做前端和 UI 设计',
    '老王是产品经理',

    // 截止时间 (2 条)
    '项目 12 月 15 号正式上线',
    'Q4 末做内部 beta',

    // 噪声 (3 条 - 不应被相关 query 召回)
    '今天天气不错',
    '中午吃了面条',
    '地铁上有人让座',
];

// ── 5 个不同方向的 query ──────────────────────────────────────
const QUERIES = [
    { q: '阿亮喜欢什么编程语言?', topic: 'user preference' },
    { q: '项目截止什么时候?', topic: 'deadline' },
    { q: '数据库用什么?', topic: 'tech choice' },
    { q: '为什么不用 MongoDB?', topic: 'decision rationale' },
    { q: '团队里有哪些人?', topic: 'team info' },
];

async function main() {
    const fs = await import('node:fs');
    for (const ext of ['', '-shm', '-wal']) {
        try { fs.unlinkSync(`./real-world.db${ext}`); } catch { /* ignore */ }
    }

    console.log('================================================================');
    console.log('  Real-world eval — REAL database (./real-world.db)');
    console.log('  Using .env config (MiniMax M3 + Aliyun qwen3.7)');
    console.log('================================================================\n');

    // ── Step 1: 真实插入 ──
    console.log(`STEP 1: Insert ${ITEMS.length} memories (real LLM pipeline)\n`);
    const insert_t0 = Date.now();
    let added = 0, skipped = 0;
    for (const item of ITEMS) {
        const r = await memory.add(item, { scope: { user_id: 'project-team' } });
        added += r.added.length;
        skipped += r.skipped.length;
        console.log(`  [${(added + skipped).toString().padStart(2)}] ${r.added.length > 0 ? '+' : 'skip'} "${item.slice(0, 30)}..."`);
    }
    console.log(`\n  Insert: ${added} added, ${skipped} dedup-skipped in ${((Date.now() - insert_t0) / 1000).toFixed(1)}s\n`);

    // ── Step 2: 真实查询(每个 query 跑 2 次,看 popularity 累积) ──
    console.log('STEP 2: Real queries (each run twice to build popularity)\n');
    let total_hits = 0, total_shown = 0;
    for (const { q, topic } of QUERIES) {
        console.log(`┌─ [${topic}] Q: ${q}`);

        // First query
        const r1 = await memory.search({ query: q, scope: { user_id: 'project-team' } });
        console.log(`│  Run 1 (top ${r1.length}):`);
        for (const x of r1) {
            console.log(`│    [score=${x.score.toFixed(3)} pop=${x.scores.popularity.toFixed(2)}] "${x.content}"`);
        }

        // Second query (same query — popularity should boost previously-returned items)
        const r2 = await memory.search({ query: q, scope: { user_id: 'project-team' } });
        console.log(`│  Run 2 (same query, popularity boost on Run 1 hits):`);
        for (const x of r2) {
            console.log(`│    [score=${x.score.toFixed(3)} pop=${x.scores.popularity.toFixed(2)}] "${x.content}"`);
        }

        // Cross-query popularity: another query retrieves the same items
        const r3 = await memory.search({ query: '项目里阿亮做什么?', scope: { user_id: 'project-team' } });
        console.log(`│  Run 3 (different query — items from Run 1-2 should also be popular here):`);
        for (const x of r3.slice(0, 3)) {
            console.log(`│    [score=${x.score.toFixed(3)} pop=${x.scores.popularity.toFixed(2)}] "${x.content}"`);
        }
        total_hits += r1.length;
        total_shown += 3;
        console.log(`│`);
    }

    // ── Step 3: 总结 ──
    console.log('================================================================');
    const s = memory.status();
    console.log(`  Database state:`);
    console.log(`    memory_count: ${s.memory_count}`);
    console.log(`    entity_count:  ${s.entity_count}`);
    console.log(`    store_kind:    ${s.store_kind}`);
    console.log(`    ready:         ${s.ready}`);
    console.log('================================================================');

    memory.close();
    console.log('\n✓ Database file saved at ./real-world.db');
    console.log('  (You can inspect with: sqlite3 ./real-world.db "SELECT * FROM memories LIMIT 5")');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });