/**
 * 指定されたディレクトリ内のすべての Markdown (.md) ファイルを読み込み、
 * 1つの文字列として結合して返します。
 *
 * @param directoryPath ADRファイルが格納されているディレクトリのパス
 * @returns 結合されたMarkdownテキスト
 */
export declare function loadAdrFiles(directoryPath: string): string;
