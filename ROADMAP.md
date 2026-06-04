# AI-Driven ADR Enforcer Development Roadmap

本ドキュメントは、`ai-adr-enforcer` (GitHub Action) の開発ロードマップを定義します。

## Phase 1: コアエンジンの開発 (LLM-as-a-Judge)
ローカル環境で動作する、ADR監査のコアロジックを実装します。

*   [x] Node.js (TypeScript) プロジェクトの初期化
*   [x] `@google/genai` を用いた LLM アクセス基盤の実装
*   [x] 指定ディレクトリ(`docs/adr/`) からのMarkdownファイル動的読み込みと結合処理
*   [x] ダミーのPR Diffを用いた、LLMによる監査プロンプト（System Instruction）の精度検証
*   [x] 判定結果をパースするための Pydantic（Structured Output相当のZod/JSON Schema）スキーマの定義

## Phase 2: GitHub Actions Integration
コアエンジンを GitHub Actions のコンテキストで動作するように結合します。

*   [x] `@actions/core` を用いた Inputs (API Key, ディレクトリパス等) の受け取り処理
*   [x] `@actions/github` (Octokit) を用いた、トリガー元 Pull Request の Diff 取得処理
*   [x] 【NFR: Privacy】ADRの内容やPRのDiffをGitHub Actionsの公開ログに露出させない「ログ出力のマスキング機能（Sensitive Data Masking）」の実装
*   [x] 監査結果（違反）に基づく、PRへのインラインコメント（Review Comment）自動投稿機能
*   [x] 【NFR: Idempotency】PRの更新時（synchronize）に、既存のAIコメントを解決（Resolve）または更新し、スパムを防ぐ重複コメント防止機能の実装
*   [x] 重大な違反（MUST FIX等）時の `core.setFailed()` によるCIブロック処理
*   [x] 【NFR: Resilience】Gemini APIのダウン・タイムアウト時に、CIをブロックする（Fail-closed）か警告のみでスキップする（Fail-open）かを選択できる設定フラグ（Action Inputs）の実装

## Phase 3: パッケージ化と Marketplace への公開
世界中の開発者が利用できるようにOSSとしてリリースします。

*   [x] `@vercel/ncc` を用いた TypeScript コードのシングルJSファイルへのビルド（コンパイル）
*   [x] `action.yml` の定義（インターフェース設計）
*   [x] READMEに具体的な利用例（ダミーADRを含めたデモ）を追記
*   [ ] GitHub Marketplace への v1.0.0 正式リリース

