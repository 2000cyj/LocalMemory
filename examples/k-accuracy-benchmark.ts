/*
*  file  : examples/k-accuracy-benchmark.ts
*  usage : Measure K accuracy and query speed on the real 239-memory database.
*          K = number of results returned (LLM may return 0 to top_k).
*
*  Run:
*    npx tsx examples/k-accuracy-benchmark.ts
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

const memory = new LongMemory({
    db_path: './real-world.db',
    llm: openai_llm({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY!,
        base_url: process.env.LONGMEMORY_OPENAI_BASE_URL ?? 'https://api.minimaxi.com/v1',
        model: process.env.LONGMEMORY_MODEL ?? 'MiniMax-M3',
    }),
    embedding: openai_embedding({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY!,
        base_url: process.env.LONGMEMORY_OPENAI_BASE_URL
            ?? 'https://ws-j43vcnj1hzb385je.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        embedding_model: process.env.LONGMEMORY_EMBEDDING_MODEL ?? 'qwen3.7-text-embedding',
        embedding_dimensions: Number(process.env.LONGMEMORY_EMBEDDING_DIM ?? 1024),
    }),
});

// Ground truth: 10 relevant entries we inserted earlier
const RELEVANT_SET = new Set([
    '项目用 ESLint + Prettier 保证代码风格一致',
    '项目用 Husky 在 pre-commit 时跑 lint',
    '项目 PR 必须经过 2 个 reviewer 才能 merge',
    '项目 CI 在 GitHub Actions 上跑',
    '项目用 Jest 做单元测试',
    '项目用 Playwright 做 E2E 测试',
    '项目代码覆盖率要求 80% 以上',
    '项目用 TypeScript strict 模式',
    '项目用 Conventional Commits 规范 commit message',
    '项目用 semantic-release 自动发版',
]);

const QUERIES = [
    '项目用什么测试工具?',
    '项目用什么代码规范?',
    'PR 怎么合并?',
    'CI 怎么配置?',
    '代码覆盖率要求多少?',
    '项目用什么版本控制?',
    '代码格式规范用什么?',
    'lint 怎么自动跑?',
    'commit message 怎么写?',
    '发版流程怎么走?',
];

async function main() {
    console.log('================================================================');
    console.log('  K Accuracy + Query Speed Benchmark');
    console.log('  Real DB: ./real-world.db (239 memories)');
    console.log('================================================================\n');

    let total_k = 0;
    let total_relevant = 0;
    let total_relevant_in_top_k = 0;
    let total_time_ms = 0;
    const stats: Array<{ q: string; k: number; hits: number; relevant: number; ms: number }> = [];

    for (const q of QUERIES) {
        const t0 = Date.now();
        const r = await memory.search({ query: q, scope: { user_id: 'project-team' }, top_k: 3 });
        const ms = Date.now() - t0;

        const hits = r.filter((x) => RELEVANT_SET.has(x.content));
        const K = r.length;

        total_k += K;
        total_relevant_in_top_k += hits.length;
        total_time_ms += ms;
        stats.push({ q, k: K, hits: hits.length, relevant: RELEVANT_SET.size, ms });

        const hits_pct = K > 0 ? ((hits.length / K) * 100).toFixed(0) : 'N/A';
        console.log(
            `  Q: ${q.padEnd(22)}  K=${K}  hits=${hits.length}  precision=${hits_pct}%  ${ms}ms`
        );
    }

    console.log('\n— ' + '-'.repeat(60) + ' —');
    console.log('  AGGREGATE:');
    console.log(`    queries: ${QUERIES.length}`);
    console.log(`    total returned (ΣK): ${total_k}`);
    console.log(`    total relevant hits:  ${total_relevant_in_top_k}`);
    console.log(`    precision@K (overall): ${total_k > 0 ? ((total_relevant_in_top_k / total_k) * 100).toFixed(1) : 'N/A'}%`);
    console.log(`    avg K per query:        ${(total_k / QUERIES.length).toFixed(1)}`);
    console.log(`    avg query time:        ${(total_time_ms / QUERIES.length).toFixed(0)}ms`);
    console.log(`    total time:            ${(total_time_ms / 1000).toFixed(1)}s`);

    // Speed breakdown
    const sorted = [...stats].sort((a, b) => b.ms - a.ms);
    console.log('\n  Slowest queries:');
    for (const s of sorted.slice(0, 3)) {
        console.log(`    ${s.ms}ms — ${s.q}`);
    }

    memory.close();
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });