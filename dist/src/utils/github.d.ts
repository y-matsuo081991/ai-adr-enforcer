/**
 * GitHub API (Octokit) を使用して、指定された Pull Request の Diff (差分) を取得します。
 *
 * @param token GitHub Personal Access Token (または GITHUB_TOKEN)
 * @param prNumber Diffを取得するPull Requestの番号
 * @returns PRのDiffを表す文字列
 */
export declare function getPrDiff(token: string, prNumber: number): Promise<string>;
