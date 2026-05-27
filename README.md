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
2. **LLM-as-a-Judge:** 変更されたコード（Diff）をGemini 2.5 Pro等の高度なモデルで監査。「なぜ違反しているのか」をADRを引用して論理的に指摘。
3. **Automated Enforcement:** 違反（MUST FIX / SHOULD FIX レベルの技術的負債）を発見した場合、PRにインラインコメントを残し、**Status Check を `Fail` にしてマージをブロック**。
4. **Zero-Configuration Setup:** 既存のプロジェクトのYAMLに数行追加するだけで、今日からアーキテクチャの自動警察が稼働。

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
        uses: y-matsuo081991/ai-adr-enforcer@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          adr_directory: 'docs/adr' # ADRファイルが置かれているディレクトリ
```

## 🧠 アーキテクチャ (How it works)

本ツールは以下のフローで自律的に動作します。

1. **Fetch:** `@actions/github` を用いてトリガーされたPRのDiffを取得。
2. **RAG (Retrieval):** 指定された `adr_directory` から `.md` ファイルを収集し、システムプロンプトとして結合。
3. **Eval:** LLMに対して「与えられたADRの制約に、このDiffは違反していないか？」と問いかけ、Pydantic (Structured Output) 形式で厳密な判定（Pass/Fail）と推論過程（Reasoning）を取得。
4. **Action:** 違反があれば GitHub API (Octokit) を通じて Review Comment を投稿し、`core.setFailed()` でCIを落とす。

## 👨‍💻 開発ロードマップ (Roadmap)
- [ ] TypeScriptと `@actions/toolkit` によるベース基盤の実装
- [ ] GitHub API (Octokit) を用いたPR Diffの取得処理
- [ ] Gemini API による LLM-as-a-Judge の判定ロジック組み込み
- [ ] PRへのインラインコメント自動投稿機能
- [ ] GitHub Marketplace へのリリース

---
*Built to empower Engineering Managers and CTOs to scale organizational rules without scaling cognitive load.*
