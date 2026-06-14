# ⏳ TODO: 自動承認機能（ADR 012）の実装ロードマップ

本ファイルは、ADR 012「ハイブリッド自動承認（Hybrid Auto-Approve）ポリシー」に準拠した自動承認機能を追加するための、人間向けの実装TODOリストです。

次回の開発再開時、または本番実装時にこの手順に沿って作業を行ってください。

---

## 🎯 変更対象ファイルと詳細TODO

### 1. `action.yml`
- [ ] `inputs` セクションの末尾に、自動承認制御パラメータを定義。
  ```yaml
    auto_approve:
      description: 'Whether to enable the hybrid auto-approve feature. Defaults to false.'
      required: false
      default: 'false'
    auto_approve_max_lines:
      description: 'The maximum allowed changed lines (additions + deletions) in program files to qualify for auto-approval.'
      required: false
      default: '30'
  ```

### 2. `src/LlmJudge.ts`
- [ ] `JudgeResultSchema` (Zod) の拡張:
  ```typescript
  const JudgeResultSchema = z.object({
    decision: z.enum(['pass', 'fail']),
    reasoning: z.string(),
    suggestion: z.string().nullable().optional(),
    risk_level: z.enum(['low', 'medium', 'high']), // 追加
  });
  ```
- [ ] `responseSchema` (Gemini API用) への追加:
  ```typescript
  risk_level: {
    type: Type.STRING,
    description: 'The risk level of the changes, either "low", "medium", or "high". Low risk are changes with zero potential architectural impact.',
  }
  // properties の required にも 'risk_level' を追加
  ```
- [ ] `systemPrompt` 内で、リスクレベル（low | medium | high）の判定基準を定義。

### 3. `src/utils/github.ts`
- [ ] 自動承認を安全に実行するための、以下の3つのヘルパー関数の実装。
  * `isAlreadyApproved(token, prNumber)`: PRの既存レビューをスキャンし、すでにBotが `APPROVED` している場合は `true` を返す（冪等性チェック）。
  * `approvePullRequest(token, prNumber)`: 署名タグ付きの自動承認レビューを投稿する。
  * `isPrSafeRules(token, prNumber, maxLines)`: 
    * `octokit.paginate` を用いて、101件目以降も含めて全変更ファイルをスキャン。
    * すべて静的ファイル（`.md`, `.json` 等）であればパス。
    * プログラムファイルが含まれる場合は、PRの合計差分行数が `maxLines` 以下であればパス。

### 4. `src/index.ts`
- [ ] 自動承認の統合フローの実装:
  * `auto_approve` 入力を受けて、有効な場合のみ自動承認ロジックへ。
  * `auto_approve_max_lines` を防衛的に数値パース（異常値が設定された場合は安全にデフォルト値 30 にフォールバック）。
  * **API障害等に対する Fail-Safe 縮退運転**: 自動承認の全プロセス（スキャン、重複チェック、投稿）を `try/catch` で囲い、例外発生時は CI を落とさずに警告（`core.warning`）を出力して正常終了（通常監査結果を返すのみ）させる。
  * **Fail-Open とのハレーション防御**: AI 監査が実際に成功し、`result.decision === 'pass'` かつ `result.risk_level === 'low'` のAND条件が厳格に成立した場合のみに自動承認レビューを制限。
  * **監査メタデータログ（Audit Trail）の出力**: 機密情報をログ出力しないルールに準拠しつつ、自動承認の合否理由（判定メタデータ）を標準出力する。

### 5. テストコードの修正と追加
- [ ] `src/__tests__/LlmJudge.test.ts`:
  * 外部API（`@google/genai`）のモック定義に、デフォルトで `risk_level: 'low'` を追記して、スキーマ変更による既存のテストエラー（デグレード）を防ぐ。
  * 新しい `risk_level` パースに関するテストケースを追加。
- [ ] `src/__tests__/index.test.ts`:
  * 自動承認フローの正常系・異常系・スキップ系のインテグレーションテストを新規追加。
  * `auto_approve` のデフォルト値（`false`）にて、既存のテスト1〜7が全く壊れない（100%パスする）ことを確認。

---

## 🚀 テスト・ビルド・マージ手順 (The NCC Rule)

開発が完了したら、以下の手順を必ず厳守してステージ・コミットを行ってください。

1. **テストスイートの検証**:
   ```bash
   npm test
   ```
   全テストケース（既存テスト含む）が 100% Green になっていることを確認。
2. **ビルドの実行（Ghost Filesの排除 & TypeScriptコンパイル）**:
   ```bash
   npm run build
   ```
   内部で `rimraf dist && ncc build src/index.ts ...` が走り、`dist/index.js` が再生成されます。
3. **成果物の同時ステージとコミット**:
   `dist/index.js` は TypeScript 変更時に同期してコミットする必要があります。
   ```bash
   git add action.yml src/ GEMINI.md TODO.md dist/index.js
   git commit -m "feat: implement hybrid auto-approve policy with robust NFR protections (ADR 012)"
   ```
