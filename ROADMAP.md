# AI-Driven ADR Enforcer Development Roadmap

本ドキュメントは、`ai-adr-enforcer` (GitHub Action) の開発ロードマップを定義します。

## Phase 1: コアエンジンの開発 (LLM-as-a-Judge)
ローカル環境で動作する、ADR監査のコアロジックを実装します。

*   [ ] Node.js (TypeScript) プロジェクトの初期化
*   [ ] `@google/genai` を用いた LLM アクセス基盤の実装
*   [ ] 指定ディレクトリ(`docs/adr/`) からのMarkdownファイル動的読み込みと結合処理
*   [ ] ダミーのPR Diffを用いた、LLMによる監査プロンプト（System Instruction）の精度検証
*   [ ] 判定結果をパースするための Pydantic（Structured Output相当のZod/JSON Schema）スキーマの定義

## Phase 2: GitHub Actions Integration
コアエンジンを GitHub Actions のコンテキストで動作するように結合します。

*   [ ] `@actions/core` を用いた Inputs (API Key, ディレクトリパス等) の受け取り処理
*   [ ] `@actions/github` (Octokit) を用いた、トリガー元 Pull Request の Diff 取得処理
*   [ ] 監査結果（違反）に基づく、PRへのインラインコメント（Review Comment）自動投稿機能
*   [ ] 重大な違反（MUST FIX等）時の `core.setFailed()` によるCIブロック処理

## Phase 3: パッケージ化と Marketplace への公開
世界中の開発者が利用できるようにOSSとしてリリースします。

*   [ ] `@vercel/ncc` を用いた TypeScript コードのシングルJSファイルへのビルド（コンパイル）
*   [ ] `action.yml` の定義（インターフェース設計）
*   [ ] READMEに具体的な利用例（ダミーADRを含めたデモ）を追記
*   [ ] GitHub Marketplace への v1.0.0 正式リリース
