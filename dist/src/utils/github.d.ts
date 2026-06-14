/**
 * ADR-009: AIが生成したテキスト内のマークダウンリンクや画像をサニタイズ（エスケープ）します。
 * 悪意あるURL（フィッシングやSlopsquatting）への誘導を防ぐための防衛的処理です。
 *
 * @param text LLMが生成した生のテキスト
 * @returns リンクが無効化されたテキスト
 */
export declare function sanitizeAiResponse(text: string): string;
/**
 * Diffのノイズとなる自動生成ファイルやバイナリファイルのチャンクを除外します。
 *
 * @param diff 生のPR Diff文字列
 * @returns フィルタリングされたDiff文字列
 */
export declare function filterDiffNoise(diff: string): string;
/**
 * GitHub API (Octokit) を使用して、指定された Pull Request の Diff (差分) を取得します。
 *
 * @param token GitHub Personal Access Token (または GITHUB_TOKEN)
 * @param prNumber Diffを取得するPull Requestの番号
 * @returns PRのDiffを表す文字列
 */
export declare function getPrDiff(token: string, prNumber: number): Promise<string>;
/**
 * Pull Request にコメントを投稿します。
 * スパム防止のため、以前にこのアクションが投稿したコメントが存在する場合は新規投稿ではなく更新（上書き）します。
 *
 * @param token GitHub Token
 * @param prNumber 対象のPull Request番号
 * @param body コメントの本文（監査結果など）
 */
export declare function postOrUpdateComment(token: string, prNumber: number, body: string): Promise<void>;
/**
 * PRに人間からの CHANGES_REQUESTED レビューが1つでも存在するか確認します。
 *
 * @param token GitHub Token
 * @param prNumber 対象のPull Request番号
 * @returns 人間からの拒否レビューがある場合は true、なければ false
 */
export declare function hasChangesRequestedFromHumans(token: string, prNumber: number): Promise<boolean>;
/**
 * 対象の PR に対して自動承認（APPROVED）のレビューを安全に投稿します。
 *
 * @param token GitHub Token
 * @param prNumber 対象のPull Request番号
 */
export declare function submitAutoApproveReview(token: string, prNumber: number): Promise<void>;
/**
 * PRで変更されたすべてのファイル名の一覧を取得します。
 * API Rate Limitを保護する防衛境界ルールに基づき、最大500ファイルまでに制限します。
 *
 * @param token GitHub Token
 * @param prNumber 対象 of Pull Request番号
 * @returns 変更ファイル名の配列
 */
export declare function getPrChangedFilesList(token: string, prNumber: number): Promise<string[]>;
export declare function hasUnresolvedComments(token: string, prNumber: number): Promise<boolean>;
/**
 * PRに投稿された人間（PR作成者以外の第三者）の全体コメント（タイムラインコメント）一覧を取得します。
 * Copilot等のBotの行コメントや、PR作成者自身のコメントは完全に無視されます。
 *
 * @param token GitHub Token
 * @param prNumber 対象のPull Request番号
 * @param prAuthor PR作成者のユーザー名
 * @returns 人間の全体コメント本文の配列
 */
export declare function getHumanGeneralComments(token: string, prNumber: number, prAuthor: string): Promise<string[]>;
