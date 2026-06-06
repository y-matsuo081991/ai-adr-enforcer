# ADR 007: ZodError による機密情報漏洩（Information Disclosure）の防止

## Status
* Proposed

## Context (背景と課題)
本ツールは `LlmJudge.ts` 内で、LLM（Gemini）からのJSONレスポンスを検証するために `zod` ライブラリを使用しています。
現状の実装では、パースに失敗した際に以下のように Zod のエラーメッセージをそのままスローし、最終的に `index.ts` の `core.setFailed()` を通じて GitHub Actions の公開ログに出力しています。

```typescript
if (error instanceof z.ZodError) {
  throw new Error(`Failed to validate LLM response schema: ${error.message}`);
}
```

LLMのレスポンスには、プロンプトとして渡した機密情報（ADRの内容）や、LLMが生成した推論結果が含まれている可能性があります。Zod はエラーメッセージの中に「実際に受け取った値（`received`）」を含めることがあり、これをそのまま出力すると、**GitHub の公開ログに企業の機密情報が平文で漏洩するリスク（Information Disclosure / Log Pollution）** があります。これはセキュリティ上、致命的な脆弱性となり得ます。

## Decision (決定事項)
ZodError が発生した場合、**エラーの生メッセージ（`error.message` や `error.issues`）を絶対にログや標準出力に露出させず、安全な静的メッセージにマスク（マスキング）する防衛的エラーハンドリング** を徹底します。

*   **実装方針:** `LlmJudge.ts` において、`z.ZodError` をキャッチした際は生のメッセージを含めず、固定の定型文（例: `Failed to validate LLM response schema. The response format was invalid.`）をスローするように修正します。

## Consequences (結果・影響)
*   **[Good] セキュリティの担保:** LLMが予期せぬレスポンスを返した際でも、ログを通じた機密情報の漏洩（NDA違反）を完全に防ぐことができます。
*   **[Bad] デバッグ難易度の低下:** 開発者が「LLMがどのような不正なJSONを返したのか」をログから直接確認できなくなります。ただし、本ツールの性質上（機密保持の優先）、このトレードオフは受け入れるべきものとします。ローカルでのデバッグ時のみ有効化できる仕組みを将来的に検討する余地はあります。
