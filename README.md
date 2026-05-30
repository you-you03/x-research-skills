# x-research-skills (Claude/ChatGPTのためのX検索レイヤー)

**「Xの今」を追うなら、Grokを検索専用マイクロサービスとして挟む。**

Claude CodeやChatGPTは文書作成や一般的なリサーチには優秀ですが、「X（Twitter）のリアルタイムトレンド」や「タイムラインの空気感」を取得するのは苦手です。これはモデルの能力ではなく、情報源（リアルタイムなXデータ）へのアクセス手段の問題です。

このリポジトリは、**Grok (xAI API)** を「検索専用ツール」として定義し、Claude CodeやChatGPTから呼び出すためのスキルセットとスクリプトを提供します。

エンジニアなら30分で導入でき、投資家やリサーチャーは情報収集の質を一段上げることができます。

## なぜGrok APIなのか？

X社が開発するGrokは、X投稿のリアルタイム検索・要約において圧倒的な強さを持ちます。
これをAPI経由で呼び出すことで、ほかの生成AIにはない以下のような「空気感」を含むリサーチが可能になります。

- **論点のクラスター化**: 単発のバズではなく、「今、界隈で何が議論されているか」の固まりを抽出
- **"生"の言い回し**: 投稿者が実際に使っているキーフレーズや用語の取得
- **ノイズ除去**: プロンプトでフォーマットを固定することで、質の低い投稿を除外

## 何が入っているか

- **Skill**: `x-research-skills/skills/article-agent-context-research/`
  - Claude Code等のAgentから呼び出すための定義ファイル
- **Script**: `x-research-skills/scripts/grok_context_research.ts`
  - Grok APIを叩き、Context Pack（リサーチ結果のMarkdown）を生成する実行スクリプト

## セットアップ

### 1. xAI API Keyの取得

[xAI公式コンソール](https://console.x.ai/)からAPI Keyを取得してください。
※ APIは有料（従量課金）です。

### 2. 環境変数の設定

取得したAPI Keyを環境変数 `XAI_API_KEY` に設定します。

```bash
export XAI_API_KEY="xai-..."
```

または `.env` ファイルを作成して設定してください。

```dotenv
XAI_API_KEY=xai-...
# 任意設定
# XAI_MODEL=grok-2-latest
# XAI_BASE_URL=https://api.x.ai
```

## 使い方 (CLI)

このリポジトリ直下 `x-research-skills/` で実行します。

```bash
cd x-research-skills
npx tsx scripts/grok_context_research.ts --topic "ClaudeにX検索を足してリサーチを自動化する"
```

### オプション
- `--topic "..."`: 調べたいトピック（必須）
- `--locale ja|global`: 検索対象（default: `ja`）
- `--audience engineer|investor|both`: 想定読者（default: `engineer`）
- `--goal "..."`: リサーチの目的
- `--days 30`: 検索期間の目安

## Method: 検索レイヤーの方針

このスクリプトは、Grokに「何でも聞く」のではなく、明確なクエリとフォーマットを指定して情報収集を行います（以下は内部ロジックの概念です）。

1. **広く薄く探索**:
   - `AI` `Web3` などの文脈で広めのクエリを投げ、タイムラインの「論点のクラスター」を抽出。
2. **論点の抽出**:
   - 収集した投稿から「繰り返し出てくる固有名詞/機能名/言い回し」を抽出し、クラスターにまとめる。
   - ※単発のバズ話題ではなく、複数の人が言及している「空気」を拾うことを重視。
3. **コンテキスト化 (Context Pack)**:
   - 最終的に「Context Pack」として、一次情報、実装例、反論、数値などをマークダウンにまとめます。

## Integration: Claude Code / Agent Skillsとしての利用

このスクリプトを `SKILL.md` として定義することで、Claude CodeなどのAgentから「Xトレンド発見スキル」として呼び出すことができます。

これにより、執筆やリサーチのフローにおいて、**「まずGrokでXの空気を吸い、その結果をClaudeに渡して記事構成を作る」** という分業が可能になります。

## Output Examples

実行すると、以下のような深いインサイトを含むレポートが得られます（例）。

```markdown
### Candidate 1
- Title/Angle: Claude Codeは“プロンプト”じゃない。SkillsでSOP化するとAIはチームになる
- Claim (1 sentence): SkillsをSOP（役割/手順/検査点）として固定すると、AIの再現性が上がり「任せられる仕事」が増える。
- Specifics (3 bullets):
  - 役割を分ける（設計/実装/レビュー）: 「全部やる」指示の暴走を止める
  - 手順を固定する（Discovery→Planning→Building）: いま何を決める時間かを確定する
  - Stop&Checkを入れる: 決まった/未決/次を毎フェーズで短く出す
```

## License

MIT

