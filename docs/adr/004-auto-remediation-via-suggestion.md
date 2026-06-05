# ADR 004: AIOps (自動修復) における Suggestion UI の採用と HITL (Human-in-the-Loop) 戦略

* **ステータス:** Proposed
* **日付:** 2026-06-05

## 1. 背景と課題 (Context & Problem)
現状の `ai-adr-enforcer` は、Pull Request における ADR（アーキテクチャ決定記録）違反を検知して CI を Fail させる「予防的統制（Preventative Control）」として機能しています。
しかし、違反を指摘された開発者は「では具体的にどう直せばよいのか」を自力で考え、手動で修正コミットを作成する必要があり、認知負荷と修正の手間（Toil）が残っています。

この課題を解決するため、Agentic AI の最新パラダイムである **自己修復（Auto-remediation）機能** の導入が提案されました。
しかし、AI エージェントが自律的に修正コードを直接対象ブランチにコミット（Direct Push）するアーキテクチャには、以下の重大なリスクが存在します。

1.  **ビジネスロジックの破壊（ハルシネーション）:** AI が生成したコードが常に 100% 正しいとは限らず、開発者の意図しない致命的なバグや破壊的変更をサイレントに混入させるリスクがあります。
2.  **コンテキストの喪失と DX の悪化:** 開発者の知らない間に自分のブランチにコミットが追加されると、手元のローカル環境との乖離が発生し、Git の競合解決やプル作業の負担増を招きます。
3.  **CI の無限ループ（Architectural Drift）:** Bot のコミットが再度 Action をトリガーし、誤った修正と再検知の無限ループに陥る運用リスク（ADR 002 に関連）があります。

## 2. 決定事項 (Decision)
自動修復（Auto-remediation）パイプラインの実装にあたり、直接のコミットを行わず、**GitHub の Review Comment における `suggestion` 記法（Suggestion UI）を採用した Human-in-the-loop (HITL) アーキテクチャ** を採用します。

1.  **Suggestion Block の生成 (The "Find and Fix" Loop):**
    LlmJudge が ADR 違反を検知（Fail）した場合、その「推論理由（Reasoning）」をもとに、制約を満たす修正後のコードスニペットを生成します。
    そして、GitHub API を用いて、PR の違反箇所に以下のような ````suggestion ```` ブロックを含むコメントを投稿します。
    ```markdown
    🚨 **Architecture Violation Detected!**
    (Reasoning...)
    
    ```suggestion
    (AIによる修正コード案)
    ```
    ```
2.  **ワンクリック修復と人間による承認 (HITL):**
    開発者は PR 画面上で AI の提案をレビューし、問題なければ GitHub の「Commit suggestion」ボタンをワンクリックして修正を取り込みます。AI はあくまで「提案（Suggest）」にとどまり、最終的なマージ権限と責任は人間（開発者）が持ちます。
3.  **プロンプトとロールの分離 (Agentic Pipeline):**
    「違反の検知（Reviewer/Judge）」と「修正コードの生成（Coder/Remediator）」は責務が異なるため、プロンプト内で明確にステップを分けるか、将来的には内部で独立したエージェント関数としてパイプライン化する設計を基本とします。
4.  **権限とセキュリティ (Least Privilege):**
    Suggestion コメントの投稿は、常に GitHub Actions が発行する一時的な `GITHUB_TOKEN` (Bot権限) を用いて行います。AIシステム自身はリポジトリの永続的な書き込み権限（Personal Access Token等）を一切保持しません。
5.  **生成失敗時のフェイルセーフ (Fail-Open):**
    LLM が提案したコード（Suggestion）が Markdown の構文として破綻している場合や、生成処理自体がエラーとなった場合は、PR の CI をハングアップさせず、フォールバックとして警告（Warning）のみを出力する Fail-Open 戦略（ADR 002 に準拠）を踏襲します。

## 3. もたらされる結果 (Consequences)

*   **【Good】安全な自己修復:** 開発者が修正内容を目視確認してから適用するため、ハルシネーションによるビジネスロジックの破壊を水際で防げます。
*   **【Good】MTTR (Mean Time to Remediate) の削減:** 開発者は手動でコードを書き直す必要がなくなり、「承認するだけ」になるため、違反の修正からマージまでのリードタイムが劇的に短縮されます。
*   **【Bad】Diff コンテキストの限界:** `suggestion` 記法は「単一ファイルの連続した行の置き換え」に特化しているため、複数ファイルにまたがる複雑なアーキテクチャ変更（ファイルの新規作成、モジュールの分割など）の自動修復には適していません。そうした複雑なケースでは、引き続き手動での修正が求められます。
