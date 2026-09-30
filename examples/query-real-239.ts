/*
*  file  : examples/query-real-239.ts
*  usage : Query the real database (now ~239 memories) and show top k.
*          Demonstrates retrieval quality with noise + relevant mixed.
*
*  Run:
*    npx tsx examples/query-real-239.ts
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
        api_key: process.env.LONGMEMORY_LLM_API_KEY!,
        base_url: process.env.LONGMEMORY_LLM_BASE_URL ?? 'https://api.minimaxi.com/v1',
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

// Queries that should match the 10 relevant entries we inserted
const QUERIES = [
    '项目用什么测试工具?',
    '项目用什么代码规范?',
    'PR 怎么合并?',
    'CI 怎么配置?',
    '代码覆盖率要求多少?',
];

async function main() {
    const status = memory.status();
    console.log(`\n=== REAL DB STATE ===`);
    console.log(`  memory_count: ${status.memory_count}`);
    console.log(`  entity_count:  ${status.entity_count}`);
    console.log(`  store_kind:    ${status.store_kind}`);

    console.log('\n=== SEARCH RESULTS (top 3 each, real LLM rerank) ===\n');
    for (const q of QUERIES) {
        console.log(`┌─ Q: ${q}`);
        const r = await memory.search({ query: q, scope: { user_id: 'project-team' } });
        for (let i = 0; i < r.length; i++) {
            const x = r[i];
            const is_relevant = /项目|测试|规范|ESLint|Prettier|Husky|Jest|Playwright|coverage|TypeScript|strict|reviewer|conventional|semantic-release|GitHub Actions|PR/i.test(x.content);
            const mark = is_relevant ? '✓' : ' ';
            console.log(`│  ${mark} [${i + 1}] score=${x.score.toFixed(3)} "${x.content}"`);
        }
        console.log(`│`);
    }

    memory.close();
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });