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
