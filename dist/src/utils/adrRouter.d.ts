import { AdrIndexEntry } from './adrLoader';
/**
 * ADR-013 Stage 1: 「軽量なインデックス（title/descriptionのみ）」と「PR Diff」を渡し、
 * このDiffの監査に関連しそうなADRファイル名だけをLLMに絞り込ませる（Document Summary Index パターン）。
 *
 * ハルシネーション対策として、responseSchemaの enum を実在するファイル名のみに動的制約し、
 * それでも実在しないファイル名が返ってきた場合はZodバリデーションで検出してエラーにする。
 */
export declare class AdrRouter {
    private ai;
    private model;
    constructor(apiKey: string, model?: string);
    selectRelevantAdrs(index: AdrIndexEntry[], prDiff: string): Promise<string[]>;
}
