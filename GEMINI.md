# AI-Driven ADR Enforcer: AI Agent Mandates

本ファイルは `ai-adr-enforcer` プロジェクトにおける AI エージェント（Gemini CLI等）の行動規範を定義する。
グローバルの制約（`~/.gemini/GEMINI.md` 等）に加えて、本プロジェクト内では以下のルールを**絶対的に優先**すること。

## 1. 🏗️ GitHub Action ビルドの絶対ルール (The NCC Rule)

本プロジェクトは TypeScript を使用した GitHub Action である。
GitHub Actions は実行時に `node_modules` をインストールせず、単一の JavaScript ファイル（通常 `dist/index.js`）を実行する仕様となっている。

*   **ALWAYS [Clean Before Build]:** ビルドを実行する際は、古いチャンクファイルや不要な `.d.ts` ファイルが `dist/` に残留（Ghost Files）し、CIエラーを引き起こすのを防ぐため、**必ずビルド前に `dist/` ディレクトリを削除（クリーンアップ）すること。** （※ `package.json` の `build` スクリプトに `rimraf dist` が組み込まれているため、原則として `npm run build` を使用すること）
*   **ALWAYS [Compile before Commit]:** `src/` 配下の TypeScript コードを変更した場合、Git にコミットする前に**必ず `@vercel/ncc` 等を用いてコンパイルおよびバンドルを行い、生成された `dist/` フォルダ内のファイルも同時にコミットせよ。**
    *   *AIへの指示:* 「実装が完了しました」と報告する前に、「ビルドコマンド（例: `npm run build`）を実行し、生成されたJSファイルをGitにステージしたか？」を必ず自己確認すること。

## 2. 🛡️ セキュリティとテストデータの取り扱い (Dummy Data Only & No Logging)

本ツールは機密情報（ADR）を扱うツールの性質上、開発およびテストにおいて厳格な情報分離が求められる。

*   **NEVER [Log Sensitive Data]:** GitHub Actionsの `console.log` や `@actions/core.info` 等を用いて、**ADRのファイル内容、PRのDiffコード、およびLLMへ送信する生のプロンプトや推論結果（Reasoning）を標準出力してはならない。** デバッグログはCIのログに半永久的に平文で残るため、重大なNDA違反（Log Pollution）となる。エラーハンドリング時も機密情報をマスクすること。
*   **NEVER [Use Real ADRs for Testing]:** 単体テストやE2Eテスト、または動作検証において、実際の業務（他プロジェクト等）の ADR やソースコードを決して使用してはならない。
*   **ALWAYS [Use Dummy Scenarios]:** テストケースを作成・実行する際は、必ず「架空のECサイト」や「架空のブログシステム」に関するダミーの ADR（例: "データベースはSQLiteを使用する"）と、ダミーの PR Diff を使用せよ。

## 3. ⚙️ 技術スタックとアーキテクチャ制約

本プロジェクトで許可されている主要な技術スタックおよび制約は以下の通り。AIはこれらを逸脱した推測やツールの選定を行ってはならない。

*   **Core Logic:** Node.js (TypeScript)
*   **LLM SDK:** `@google/genai` (旧版の `@google/generative-ai` ではなく、新しい標準SDKを使用すること)
*   **GitHub Integration:** `@actions/core`, `@actions/github`
    *   **【MUST: Version Constraint】** `@actions/core` v3 等の最新版は純粋な ESM パッケージであり、GitHub Actions の `ncc` による CommonJS への単一ファイルバンドル運用および、`ts-jest` によるテスト環境と極めて相性が悪い。TDD の安定稼働を最優先するため、本プロジェクトでは意図的に **CommonJS をサポートする `@actions/core@^2.0.0` および `@actions/github@^6.0.0` を使用** すること。無理に Jest を ESM モードに変更したり、複雑な `moduleNameMapper` を設定してはならない。
*   **Validation:** 外部API連携や出力のパースには `zod` またはそれに準ずる型安全なスキーマバリデーションを使用すること。
*   **Architecture Rule (ADR 001):** 本ツールは「推論エンジン」であり、ADR の内容は実行時に動的に読み込む。ツール本体のコード内にいかなるルール（Policy）もハードコードしてはならない。

## 4. ⏳ 【次回引き継ぎ】自動承認機能 (ADR 012) の実装 TODO & ハレーション防止命令

本機能の実装は未完了である。次回以降のセッションで本作業を再開する場合、AIエージェントは以下の**ハレーション防止制約**を100%遵守し、TODOを完遂せよ。

### 🛡️ 自動承認における絶対安全命令 (Safety Mandates)
1. **LlmJudge テストの互換性確保 [MUST]:** `LlmJudge.ts` で `risk_level` スキーマを拡張する際、`src/__tests__/LlmJudge.test.ts` 内の外部API（`@google/genai`）モックに必ずデフォルト値として `risk_level: 'low'` を追記し、既存のすべてのモックテストが破綻（Zodパースエラー）するのを絶対に防ぐこと。
2. **Fail-Open 時の自動承認の完全防御 [MUST]:** Gemini API のタイムアウト等で `fail_open: true` が作動した際、「AI監査未実施のPR」が勝手に自動承認される重大なセキュリティホールを防ぐため、`result` が正常に取得でき、かつ `result.decision === 'pass'` かつ `result.risk_level === 'low'` のAND条件が厳格に成立した場合のみに自動承認レビューを制限すること。
3. **Fail-Safe 縮退運転の実装 [MUST]:** 自動承認処理内の GitHub API コールにおいて、例外（APIエラー、Rate Limit、権限不足等）が発生した場合は、PRのCIを落とさずに `warning` を出力して安全にスキップ（通常終了）させること。
4. **The NCC Rule の遵守 [MUST]:** 実装およびテスト修正の完了後は、必ず `npm run build` を実行して `dist/index.js` をコンパイル・更新し、ソースコードとバンドル成果物を同時に Git へコミット・ステージすること。

### 📝 実装TODOリスト
* [ ] **`action.yml`**: `auto_approve` (Boolean, Default: false) と `auto_approve_max_lines` (Number, Default: 30) のパラメータを定義する。
* [ ] **`src/LlmJudge.ts`**: `JudgeResultSchema` および `responseSchema` (Gemini API用) に `risk_level: z.enum(['low', 'medium', 'high'])` を追加し、システムプロンプトを拡張する。
* [ ] **`src/utils/github.ts`**: `isPrSafeRules` (paginate全スキャン版), `isAlreadyApproved` (冪等性チェック), `approvePullRequest` の3つのヘルパーを実装する。
* [ ] **`src/index.ts`**: 防衛的な入力値変換、判定メタデータログ（Audit Trail）、および Fail-Safe 縮退運転を内包した自動承認統合フローを実装する。
* [ ] **`src/__tests__/`**: `LlmJudge.test.ts` のモック拡張、および `index.test.ts` への自動承認テストの安全な追加、全テストの実行。


