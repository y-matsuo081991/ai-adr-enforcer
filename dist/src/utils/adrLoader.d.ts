/**
 * 指定されたディレクトリ内のすべての Markdown (.md) ファイルを読み込み、
 * 1つの文字列として結合して返します。
 *
 * @param directoryPath ADRファイルが格納されているディレクトリのパス
 * @returns 結合されたMarkdownテキスト
 */
export declare function loadAdrFiles(directoryPath: string): string;
export interface AdrIndexEntry {
    fileName: string;
    title: string;
    description: string;
}
/**
 * ADR-013: frontmatterの`title`/`description`のみを抽出した軽量インデックスを構築します（Document Summary Index）。
 * Stage 1（関連ADRの絞り込み）のLLM呼び出しに、全文の代わりに渡すために使用します。
 *
 * frontmatterを持たない古い形式のADRファイルにも後方互換的に対応し、
 * 本文の最初の見出し（`# ...`）を title としてフォールバックします。
 */
export declare function loadAdrIndex(directoryPath: string): AdrIndexEntry[];
/**
 * ADR-013 Stage 2: Stage 1で絞り込まれたファイル名のADRのみ、フル本文を結合して返します。
 * `loadAdrFiles` と同じ `MAX_ADR_SIZE` の安全側マージンを、絞り込んだ結果に対しても引き続き適用します。
 * 実在しないファイル名（LLMのハルシネーション等）が含まれていても無視し、クラッシュしません。
 */
export declare function loadAdrFilesByNames(directoryPath: string, fileNames: string[]): string;
