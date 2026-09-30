import { LongMemory, openai_llm, openai_embedding } from '../dist/index.js';

const memory = new LongMemory({
    db_path: './real-world.db',
    llm: openai_llm({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY,
        base_url: process.env.LONGMEMORY_LLM_BASE_URL ?? 'https://api.minimaxi.com/v1',
        model: process.env.LONGMEMORY_LLM_MODEL ?? 'MiniMax-M3',
    }),
    embedding: openai_embedding({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY,
        base_url: process.env.LONGMEMORY_OPENAI_BASE_URL ?? 'https://ws-j43vcnj1hzb385je.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        embedding_model: process.env.LONGMEMORY_EMBEDDING_MODEL ?? 'qwen3.7-text-embedding',
        embedding_dimensions: Number(process.env.LONGMEMORY_EMBEDDING_DIM ?? 1024),
    }),
});

const r = await memory.search({
    query: 'PR 怎么合并?',
    scope: { user_id: 'project-team' },
    top_k: 3,
});

console.log('Query: PR 怎么合并?');
console.log(`Returned ${r.length} results:\n`);
for (const [i, x] of r.entries()) {
    console.log(`[${i+1}] score=${x.score.toFixed(4)}`);
    console.log(`    "${x.content}"`);
    console.log(`    signals: sem=${x.scores.semantic.toFixed(2)} kw=${x.scores.keyword.toFixed(2)} ent=${x.scores.entity.toFixed(2)} temp=${x.scores.temporal.toFixed(2)} pop=${x.scores.popularity.toFixed(2)}`);
    console.log();
}

memory.close();
