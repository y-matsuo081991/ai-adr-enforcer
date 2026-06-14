# 🛡️ AI-Driven ADR Enforcer

> **"Architecture Governance as Code"**
>
> 組織で合意したアーキテクチャの意思決定（ADR: Architecture Decision Records）が、日々のPull Requestで確実に守られているかを **AI (LLM-as-a-Judge) が自動監査し、負債の混入を水際でブロックする** GitHub Action です。

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-AI--ADR--Enforcer-blue.svg)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](#)

## 📖 背景と解決する課題 (Why this exists)

アジャイルな組織において、技術的負債を防ぐために **ADR（アーキテクチャ決定記録）** を制定することはベストプラクティスです（例: 「直接DBに繋いではならない」「特定のライブラリを使ってはならない」等）。

しかし、どれだけ立派なADRを作っても、**「人間（レビュアー）がそれをすべて記憶し、PRのたびに目視でチェックする」** ことは不可能であり、すぐにルールは形骸化し、システムは腐敗（Architectural Drift）していきます。

`AI-Driven ADR Enforcer` はこの問題を解決します。
AIがリポジトリ内のすべてのADRを読み込み、PRのDiff（差分コード）と突き合わせることで、「制定された法律（ADR）」に違反するコードを自動的に検知・リジェクトし、CTOやアーキテクトの認知負荷を劇的に下げます。

## ✨ 主な機能 (Features)

1. **Context-Aware Review:** リポジトリ内の `docs/adr/` 等のMarkdownファイルを動的に読み込み、プロジェクト固有のルールを学習。
2. **LLM-as-a-Judge:** 変更されたコード（Diff）をGemini 3.1 Pro 等の高度なモデルで監査。「なぜ違反しているのか」をADRを引用して論理的に指摘。
3. **Auto-remediation (自己修復):** 違反を検知した際、AIが制約を満たす修正コード（Suggestion）を自動生成し、**ワンクリックでコミット可能な形でPRに提案**。
4. **Automated Enforcement:** 違反（MUST FIX / SHOULD FIX レベルの技術的負債）を発見した場合、PRにインラインコメントを残し、**Status Check を `Fail` にしてマージをブロック**。
5. **Hybrid Auto-Approve (ハイブリッド自動承認):** 軽微な差分（デフォルト30行以下）や安全なファイル（`.md`, `package.json`, `tsconfig.json`, `*.yml`等）のみの変更で、AIが「リスク極小 (risk_level: low)」と判定した場合、自動でPRをApprove（承認）します。リスクが `medium` 以上の場合は自動承認を安全にスキップして手動レビューにハンドオフします。
6. **Escape Hatch (脱出ハッチ):** AIの誤検知時や緊急対応時に、特定のラベル（`bypass-adr`）を付与するだけでAIの監査を安全に強制スキップ可能。
7. **Enterprise-Grade Security:** Prompt Injection対策（System Instructionの分離）や、ハルシネーションによるフィッシングリンクを無効化する出力サニタイズ機構を標準搭載。

## 🚀 使い方 (Usage)

`.github/workflows/adr-enforcer.yml` を作成し、以下のように設定するだけです。

```yaml
name: Architecture Governance
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  enforce-adr:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: AI-Driven ADR Enforcer
        uses: y-matsuo081991/ai-adr-enforcer@v1.0.0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          adr_directory: 'docs/adr' # ADRファイルが置かれているディレクトリ
          fail_open: 'false' # API障害時にCIをパスさせる場合は 'true'
          auto_approve: 'true' # ハイブリッド自動承認を有効化 (デフォルト: false)
          auto_approve_max_lines: '30' # 自動承認のしきい値行数 (デフォルト: 30)
```

### 🔒 GitHub App を使った自動承認の高度な連携 (Advanced: GitHub App Integration)

GitHub のデフォルトトークンである `${{ secrets.GITHUB_TOKEN }}` を使ってPRを自動承認（APPROVE）した場合、**GitHub のセキュリティ制限（Recursion Prevention / ワークフロー再帰防止）により、その承認をトリガーとした他の GitHub Actions（例: 自動マージ、別の検証CI、デプロイ等）は実行されません。** また、Branch Protection Rule（ブランチ保護ルール）で「PRレビューの最小承認数」を設定している場合、`GITHUB_TOKEN` による承認が承認レビュー数にカウントされないことがあります。

これを回避し、**自動承認から自動マージ・デプロイまでを完全に自動化（シームレスに連携）する**には、各企業・プロジェクト側でカスタムの **GitHub App** を作成し、そのトークンを使用するのがベストプラクティスです。

#### 🛠️ 設定手順

1. **GitHub App の作成**:
   - Organization（または個人アカウント）の Settings > Developer settings > GitHub Apps > **New GitHub App** を開きます。
   - Webhook の `Active` はオフにして構いません。
   - **Repository permissions** で以下を設定・付与します：
     - **Pull requests**: `Read & write` （自動レビュー承認の投稿に必要）
     - **Contents**: `Read-only` （PRのコード差分やADRファイルの読み込みに必要）
   - アプリを保存し、表示される **App ID** を控えます。
   - 画面下部から **Private key** (`.pem` ファイル) を生成してダウンロードします。

2. **GitHub Secrets への登録**:
   - 対象のリポジトリの Settings > Secrets and variables > Actions に以下を登録します。
     - `ADR_ENFORCER_APP_ID`: 控えた App ID
     - `ADR_ENFORCER_PRIVATE_KEY`: ダウンロードした `.pem` ファイルの全テキスト

3. **ワークフロー YAML の記述例**:
   - GitHub公式の `actions/create-github-app-token` アクションを使い、実行時に一時トークンを生成して本アクションの `github_token` に引き渡します。

```yaml
name: Architecture Governance

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  enforce-adr:
    runs-on: ubuntu-latest
    steps:
      # 1. GitHub App トークンの生成
      - name: Generate GitHub App Token
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.ADR_ENFORCER_APP_ID }}
          private-key: ${{ secrets.ADR_ENFORCER_PRIVATE_KEY }}

      # 2. コードのチェックアウト
      - name: Checkout Code
        uses: actions/checkout@v4

      # 3. ADR Enforcer の実行 (App トークンを使用)
      - name: AI-Driven ADR Enforcer
        uses: y-matsuo081991/ai-adr-enforcer@v1.0.0
        with:
          github_token: ${{ steps.app-token.outputs.token }} # 生成した App トークン
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          adr_directory: 'docs/adr'
          auto_approve: 'true' # 自動承認を有効化
```

## 💡 具体的な利用例 (Example in Action)

このツールがどのように機能するか、架空のブログシステムを例に解説します。

### 1. ADRの定義 (プロジェクトの法律)
`docs/adr/001-database-selection.md` に以下のルールが定義されているとします。
> **Decision:**  
> 当プロジェクトのブログ記事データは、必ず **SQLite** を使用して保存すること。環境構築の容易さを最優先するため、MySQLやPostgreSQLなどの外部プロセスを必要とするDBは採用してはならない。

### 2. 開発者のPull Request (違反コード)
ある開発者が、よかれと思って `PostgreSQL` に接続するコードをコミットしました。

```javascript
// src/db.js
- const db = new sqlite3.Database(':memory:');
+ const { Client } = require('pg');
+ const db = new Client({ connectionString: process.env.DATABASE_URL });
+ db.connect();
```

### 3. AIの監査と自動修復の提案 (Enforcement & Auto-remediation)
GitHub Actionがトリガーされると、AIがこの違反を検知し、PRに以下のような自動コメントを投稿し、マージをブロック（Fail）します。

> 🚨 **Architecture Violation Detected!**
> 
> 提案されたコード変更は `pg` モジュールを導入し PostgreSQL に接続しようとしていますが、これはプロジェクトの規約に明確に違反しています。
> Reference ADR: `001-database-selection.md`
> 
> ### 💡 Auto-remediation Suggestion
> \`\`\`suggestion
> const sqlite3 = require('sqlite3').verbose();
> const db = new sqlite3.Database(':memory:');
> \`\`\`

開発者は、GitHubのPR画面上に表示される **「Commit suggestion」ボタン** をクリックするだけで、AIの提案した修正コードを安全にブランチへ取り込むことができます。

## 🧠 アーキテクチャ (How it works)

本ツールは以下のフローで自律的に動作します。

1. **Fetch:** `@actions/github` を用いてトリガーされたPRのDiffを取得。
2. **RAG (Retrieval):** 指定された `adr_directory` から `.md` ファイルを収集し、システムプロンプトとして結合。
3. **Eval:** LLMに対して「与えられたADRの制約に、このDiffは違反していないか？」と問いかけ、Pydantic (Structured Output) 形式で厳密な判定（Pass/Fail）と推論過程（Reasoning）を取得。
4. **Action:** 違反があれば GitHub API (Octokit) を通じて Review Comment を投稿し、`core.setFailed()` でCIを落とす。
