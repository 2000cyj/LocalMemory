/*
*  file  : examples/insert-noise-and-relevant.ts
*  usage : Insert 100 noise + 10 relevant. Skips LLM pipeline
*          (fact_extractor/dedup/entity) and inserts directly with embedding.
*          Faster than the full pipeline (no LLM dedup/entity calls).
*
*  Run:
*    npx tsx examples/insert-noise-and-relevant.ts
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
import BetterSqlite3 from 'better-sqlite3';

const LLM_BASE = process.env.LONGMEMORY_LLM_BASE_URL ?? 'https://api.minimaxi.com/v1';
const EMB_BASE = process.env.LONGMEMORY_OPENAI_BASE_URL
    ?? 'https://ws-j43vcnj1hzb385je.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

const memory = new LongMemory({
    db_path: './real-world.db',
    llm: openai_llm({
        api_key: process.env.LONGMEMORY_OPENAI_API_KEY!,
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

const NOISE = [
    '今天早餐吃了煎饼果子', '下午茶点了在地铁里', '明天下雨记得带伞',
    '刚买的书翻了几页', '晚饭准备做红烧肉', '冰箱里的牛奶过期了',
    '猫把花瓶打翻了', '楼下在装修很吵', '新买的鞋子磨脚',
    '同事请喝了奶茶', '周末计划去看展', '加班到很晚',
    '出差去上海开会', '高铁票还没买', '酒店房间很干净',
    '用了 React 写了新项目', 'Python 写爬虫效率高', 'Java 做企业级应用',
    'Go 语言性能很好', 'Rust 学习曲线陡峭', 'Kotlin 和 Java 兼容',
    'Swift 写 iOS 应用', 'PHP 还在维护老项目', 'Ruby 写脚本方便',
    'C++ 做底层优化', 'C# 做 Windows 应用', 'MATLAB 做数值计算',
    'R 做统计分析', 'Perl 处理文本强大', 'Scala 处理并发',
    '最近在学吉他和弦', '跑步 5 公里用 28 分钟', '游泳能游 500 米',
    '瑜伽坚持练了半年', '读书会上推荐了《活着》', '追剧追到凌晨三点',
    '游戏通关了《黑神话》', '旅游去了趟大理', '露营装备买齐了',
    '滑雪第一次摔了三次', '冲浪学会了起乘', '咖啡喝了美式',
    'iPhone 16 首发买了', 'MacBook Pro 换了 M4', 'AirPods Pro 2 升级了',
    'iPad mini 7 入手', 'Apple Watch 10 戴上了', 'HomePod 音质不错',
    '邻居家养了只金毛', '楼下开了家咖啡店', '快递终于到了',
    '换季感冒了', '体检报告正常', '眼睛度数涨了',
    '驾照换新了', '车险到期了', '房贷利率调整了',
    '股票又跌了', '基金分红到账了', '保险续费了',
    '手机贴膜了', '充电宝买了新的', '键盘换了静音的',
    '鼠标没电了', '显示器升级了 4K', '硬盘坏了数据丢了',
    '路由器重启了', 'WiFi 信号差', '宽带升级了千兆',
    '空调清洗了', '洗衣机换了', '冰箱加了',
    '电视换过', '沙发搬了', '桌子买了',
    '床单换了', '窗帘换了', '灯具换了',
    '装修完了', '搬家了', '租房到期了',
    '续约了', '退租了', '押金退了',
    '中介找了', '看房了', '签约了',
    '入住了', '退押金了', '拿钥匙了',
    '过户了', '卖了', '租了',
    '装修预算 30 万', '贷款 100 万', '首付 50 万',
    '月供 8000 元', '利率 4.2%', '贷款 30 年',
];

const RELEVANT = [
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
];

async function batch_embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const url = `${EMB_BASE.replace(/\/+$/, '')}/embeddings`;
    // Aliyun limits batch size to 20 — chunk
    const BATCH = 20;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
        const slice = texts.slice(i, i + BATCH);
        const body: Record<string, unknown> = {
            model: process.env.LONGMEMORY_EMBEDDING_MODEL ?? 'qwen3.7-text-embedding',
            input: slice,
        };
        const dim = process.env.LONGMEMORY_EMBEDDING_DIM ?? '1024';
        body.dimensions = Number(dim);
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.LONGMEMORY_OPENAI_API_KEY}`,
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
        const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
        const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        out.push(...sorted.map((x) => x.embedding));
    }
    return out;
}

function pack_embedding(vec: number[]): Buffer {
    const buf = Buffer.alloc(vec.length * 4);
    for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
    return buf;
}

async function main() {
    console.log(`Insert ${NOISE.length} noise + ${RELEVANT.length} relevant = ${NOISE.length + RELEVANT.length} total\n`);

    // Batch all items
    const allItems = [
        ...NOISE.map((text, i) => ({ text, scope: 'noise', idx: i })),
        ...RELEVANT.map((text, i) => ({ text, scope: 'project-team', idx: i })),
    ];

    console.log(`─── Batch embedding ${allItems.length} items ───`);
    const emb_t0 = Date.now();
    const all_embeddings = await batch_embed(allItems.map((x) => x.text));
    console.log(`  embedded in ${((Date.now() - emb_t0) / 1000).toFixed(1)}s\n`);

    // Direct SQLite insert (bypass LLM pipeline)
    console.log(`─── Direct SQL insert (bypassing LLM extract/dedup/entity) ───`);
    const db = new BetterSqlite3('./real-world.db');
    db.pragma('journal_mode = WAL');

    const insert_stmt = db.prepare(`
        INSERT INTO memories
        (id, scope_user_id, content, embedding, embedding_dim, source, created_at, updated_at, access_count)
        VALUES (?, ?, ?, ?, ?, 'user', ?, ?, 0)
    `);
    const now = Date.now();
    const all_ts = Date.now();

    const tx = db.transaction((items: Array<{ text: string; scope: string; idx: number }>) => {
        for (const item of items) {
            const id = `mem_${item.scope}_${item.idx}_${all_ts}_${Math.random().toString(36).slice(2, 6)}`;
            insert_stmt.run(id, item.scope, item.text, pack_embedding(all_embeddings[items.indexOf(item)]), Number(process.env.LONGMEMORY_EMBEDDING_DIM ?? 1024), all_ts, all_ts);
        }
    });
    tx(allItems);

    db.close();

    console.log(`✓ Done in ${((Date.now() - emb_t0) / 1000).toFixed(1)}s`);

    const status = memory.status();
    console.log(`\nDB state: memory_count=${status.memory_count}  entity_count=${status.entity_count}`);

    memory.close();
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });