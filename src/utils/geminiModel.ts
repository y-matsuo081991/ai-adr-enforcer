/**
 * LlmJudge / AdrRouter / index.ts が共通で使うGeminiモデルのデフォルト値。
 *
 * 実際に使われるモデルは `action.yml` の `model` 入力（ワークフロー側で上書き可能）が優先されるため、
 * これはあくまで「未指定時のフォールバック」であり、コード側の唯一の真実（Single Source of Truth）として、
 * ここ1箇所を変更すれば全ての利用箇所に反映される。
 *
 * 注意: `action.yml` 自体のYAML内デフォルト値（GitHub Actionsの仕様上、動的参照ができない）だけは、
 * この定数とは独立して手動で同期させる必要がある。
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
