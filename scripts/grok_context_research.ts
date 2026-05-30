/**
 * Create a "Context Pack" by researching a given topic using xAI (Grok) + x_search.
 *
 * - Designed for pre-writing research (not post-writing factcheck).
 * - Accepts a free-form topic/question and produces a structured markdown pack.
 * - Saves artifacts under data/context-research/ (json/txt/md) with timestamps.
 *
 * Requires:
 *   XAI_API_KEY in env or .env
 *
 * Usage:
 *   npx tsx scripts/grok_context_research.ts --topic "ClaudeにX検索を足してリサーチを自動化する"
 *   npx tsx scripts/grok_context_research.ts --topic "X API recent search rate limits" --locale global --audience engineer
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const DEFAULT_BASE_URL = "https://api.x.ai";
const DEFAULT_MODEL = "grok-4-1-fast-reasoning";

function repoRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), "..");
}

function loadDotenv(dotenvPath: string): Record<string, string> {
  if (!fs.existsSync(dotenvPath)) return {};
  const out: Record<string, string> = {};
  const lines = fs.readFileSync(dotenvPath, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (!k) continue;
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function timestampSlug(d: Date): string {
  const iso = d.toISOString();
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  const hh = iso.slice(11, 13);
  const mm = iso.slice(14, 16);
  const ss = iso.slice(17, 19);
  return `${y}${m}${day}_${hh}${mm}${ss}Z`;
}

function parseArgs(argv: string[]) {
  const args = {
    topic: "",
    locale: "ja" as "ja" | "global",
    audience: "engineer" as "engineer" | "investor" | "both",
    goal: "記事を深くするための周辺情報リサーチ（一次情報/用語/反論/数字を揃える）",
    days: 30,
    out_dir: "data/context-research",
    xai_api_key: "",
    xai_base_url: "",
    xai_model: "",
    dry_run: false,
    raw_json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : "");
    if (a === "--topic") args.topic = next();
    else if (a === "--locale") {
      const v = next().trim().toLowerCase();
      args.locale = v === "global" ? "global" : "ja";
    } else if (a === "--audience") {
      const v = next().trim().toLowerCase();
      args.audience = v === "investor" ? "investor" : v === "both" ? "both" : "engineer";
    } else if (a === "--goal") args.goal = next() || args.goal;
    else if (a === "--days") args.days = Number(next());
    else if (a === "--out-dir") args.out_dir = next() || args.out_dir;
    else if (a === "--xai_api_key") args.xai_api_key = next();
    else if (a === "--xai_base_url") args.xai_base_url = next();
    else if (a === "--xai_model") args.xai_model = next();
    else if (a === "--dry-run") args.dry_run = true;
    else if (a === "--raw-json") args.raw_json = true;
    else if (a === "-h" || a === "--help") {
      // eslint-disable-next-line no-console
      console.log(`Usage:
  tsx scripts/grok_context_research.ts --topic "..."

Options:
  --topic TEXT       what to research (required)
  --locale L         ja or global (default: ja)
  --audience A       engineer / investor / both (default: engineer)
  --goal TEXT        research goal (default: pre-writing context)
  --days N           lookback hint in days (default: 30)
  --out-dir DIR      output directory (default: data/context-research)
  --dry-run          print request payload and exit
  --raw-json         also print raw JSON response to stderr
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.days) || args.days <= 0) args.days = 30;
  return args;
}

function getConfig(args: ReturnType<typeof parseArgs>) {
  const dotenv = loadDotenv(path.join(repoRoot(), ".env"));
  const getStr = (envKey: string, cliValue: string, fallback: string) =>
    cliValue || process.env[envKey] || dotenv[envKey] || fallback;

  const xai_api_key = getStr("XAI_API_KEY", args.xai_api_key, "");
  const xai_base_url = getStr("XAI_BASE_URL", args.xai_base_url, DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const xai_model = getStr("XAI_MODEL", args.xai_model, DEFAULT_MODEL);

  return { xai_api_key, xai_base_url, xai_model };
}

function buildPrompt(input: {
  topic: string;
  locale: "ja" | "global";
  audience: "engineer" | "investor" | "both";
  goal: string;
  days: number;
  nowIso: string;
}): string {
  const now = new Date(input.nowIso);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const todayStr = now.toISOString().split("T")[0];
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const hours = input.days * 24;
  const count = 10;

  const localeBlock =
    input.locale === "ja"
      ? "\n- 対象言語: 日本語優先（日本のトレンド）"
      : "\n- 対象言語: 英語/グローバル優先";

  const modeBlock =
    input.audience === "engineer"
      ? "\n- 視点: エンジニア視点（技術詳細、実装、DevTools）"
      : input.audience === "investor"
        ? "\n- 視点: 投資家視点（市場、資金調達、トークン）"
        : "\n- 視点: エンジニアと投資家の両方";

  const mustBlock = input.goal ? `\n- 重点テーマ: ${input.goal}` : "";
  const seedBlock = ""; // seed is not currently exposed in args

  return `
目的: X(Twitter)でimpressionsを最大化するための投稿ネタ出し。
前提:
- アカウント: 個人発信
- 想定読者: 投資家 + エンジニア
- 領域: ${input.topic}
- 文体: 常体、ストーリー薄め、結論先出し
- 期間: 「昨日と今日」= ${yesterdayStr} と ${todayStr}（直近 ${hours} 時間を目安）${localeBlock}${modeBlock}${mustBlock}${seedBlock}

やること（重要: 空気を拾うための探索手順）:
1) まず「広く薄く」探索して、タイムラインの空気（論点のクラスター）を抽出する:
   - seed が無い場合: AI/Web3/開発者ツール文脈に対して、広めのクエリを12個以上自分で作って X 検索する
   - 収集した投稿から「繰り返し出てくる固有名詞/機能名/言い回し」を抽出し、3-5クラスターにまとめる（単発の話題はクラスターにしない）
   - さらに、上で抽出した「繰り返し出てくる機能名/短いフレーズ」を2-5個選び、それをクエリとして追加検索して補強する（これで"Agent Teams"のような空気が自然に取れる）
   - 可能ならXの検索オペレータを使って「バズ」を拾う（例: min_faves:500, min_retweets:100, since:YYYY-MM-DD）。使えない場合は、その旨を明記して代替手段（候補を多めに拾って上位を選ぶ）に切り替える
2) 次に、クラスターごとに代表ポストを2つずつ選ぶ（長文の直接引用はしない）。
3) その後、合計${count}件の「素材」を出す（AIとWeb3は偏らせない）。
4) 各素材ごとに以下を必ず出す:
- url（Xの投稿URL。無ければ一次情報URL）
- 要約（1-2行、自分の言葉）
- エンゲージ指標（観測できたものだけ。例: likes=?, retweets=?, replies=?, views=?。不明は unknown）
- なぜ伸びたか（仮説を3つまで）
- ここから作れる投稿ネタ案（投資家向け1つ、エンジニア向け1つ）
- フック案（1行を3つ）
- 注意（断定/投資助言に見えない言い回しへ調整点があれば1行）

追加の要求（空気感を出す）:
- 最初に「タイムラインの空気（論点のクラスター）」を3-5個、各クラスターに代表ポストURLを2つずつ付ける
- その上で「投稿者が使っている言い回し/キーフレーズ」を各クラスターにつき2-3個（そのまま引用せず、短い言い換えで）
- 不確かなゴシップは避け、一次情報/公式発表/本人発言を優先する。裏が取れない場合は「未確認」と明記する
- 投資助言に見える表現は禁止（買い/売り推奨、株価や価格の目標・倍化など）。投資家向けネタ案は「論点/評価軸/事業インパクト」の形で書く

出力形式:
- 最初に「タイムラインの空気（論点のクラスター）」を箇条書き
- 次に「今日の結論（狙うべき3テーマ）」を箇条書き
- 次に「素材一覧」を番号付きで${count}件
- 最後に url だけの一覧をまとめて
`.trim();
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: Json,
  timeoutMs: number,
): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 4000)}`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(t);
  }
}

function extractText(resp: unknown): string {
  if (resp && typeof resp === "object") {
    const r = resp as { [k: string]: unknown };
    const out = r["output"];
    if (Array.isArray(out)) {
      const parts: string[] = [];
      for (const item of out) {
        if (!item || typeof item !== "object") continue;
        const content = (item as { [k: string]: unknown })["content"];
        if (!Array.isArray(content)) continue;
        for (const c of content) {
          if (!c || typeof c !== "object") continue;
          const t = (c as { [k: string]: unknown })["text"];
          if (typeof t === "string" && t.trim()) parts.push(t);
        }
      }
      if (parts.length) return parts.join("\n").trim();
    }
    for (const k of ["output_text", "text", "content"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return JSON.stringify(resp, null, 2);
}

function saveFile(outDir: string, filename: string, content: string) {
  const root = repoRoot();
  const absDir = path.isAbsolute(outDir) ? outDir : path.join(root, outDir);
  fs.mkdirSync(absDir, { recursive: true });
  const p = path.join(absDir, filename);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getConfig(args);

  if (!cfg.xai_api_key.trim()) {
    // eslint-disable-next-line no-console
    console.error("Missing XAI_API_KEY. Set it in .env or environment.");
    process.exit(2);
  }
  if (!args.topic.trim()) {
    // eslint-disable-next-line no-console
    console.error("Missing --topic. Example: --topic \"ClaudeにX検索を足してリサーチを自動化する\"");
    process.exit(2);
  }

  const now = new Date();
  const prompt = buildPrompt({
    topic: args.topic.trim(),
    locale: args.locale,
    audience: args.audience,
    goal: args.goal,
    days: args.days,
    nowIso: now.toISOString(),
  });

  const payload: Json = {
    model: cfg.xai_model,
    input: prompt,
    tools: [{ type: "x_search" }],
  };

  if (args.dry_run) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const url = `${cfg.xai_base_url}/v1/responses`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.xai_api_key}`,
  };

  const resp = await postJson(url, headers, payload, 180_000);
  const text = extractText(resp);

  const ts = timestampSlug(now);
  // Primary artifact name aligns with skills requirement: YYYYMMDD_HHMMSSZ_context.md
  const base = `${ts}_${args.locale}_context`;
  const md = `# Context Pack (${args.locale})\n\n## Meta\n- Timestamp (UTC): ${now.toISOString()}\n- Topic: ${args.topic.trim()}\n- Audience: ${args.audience}\n\n---\n\n${text}\n`;

  const jsonFile = saveFile(args.out_dir, `${base}.json`, JSON.stringify(
    {
      timestamp: now.toISOString(),
      topic: args.topic.trim(),
      params: {
        locale: args.locale,
        audience: args.audience,
        goal: args.goal,
        days: args.days,
        model: cfg.xai_model,
        base_url: cfg.xai_base_url,
        out_dir: args.out_dir,
      },
      request: payload,
      response: resp,
      extracted_text: text,
    },
    null,
    2,
  ));
  const txtFile = saveFile(args.out_dir, `${base}.txt`, text);
  const mdFile = saveFile(args.out_dir, `${ts}_context.md`, md);

  // eslint-disable-next-line no-console
  console.error(`Saved: ${path.relative(process.cwd(), jsonFile)}`);
  // eslint-disable-next-line no-console
  console.error(`Saved: ${path.relative(process.cwd(), txtFile)}`);
  // eslint-disable-next-line no-console
  console.error(`Saved: ${path.relative(process.cwd(), mdFile)}`);

  if (args.raw_json) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(resp, null, 2));
  }

  // eslint-disable-next-line no-console
  console.log(text);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(String(err));
  process.exit(1);
});
