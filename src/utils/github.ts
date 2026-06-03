import * as github from '@actions/github';

/**
 * GitHub API (Octokit) を使用して、指定された Pull Request の Diff (差分) を取得します。
 * 
 * @param token GitHub Personal Access Token (または GITHUB_TOKEN)
 * @param prNumber Diffを取得するPull Requestの番号
 * @returns PRのDiffを表す文字列
 */
export async function getPrDiff(token: string, prNumber: number): Promise<string> {
  try {
    const octokit = github.getOctokit(token);
    
    // context.repo には owner と repo が含まれている
    const { owner, repo } = github.context.repo;

    // mediaType.format に 'diff' を指定することで、JSONではなくDiffの生テキストを取得できる
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: 'diff',
      },
    });

    // response.data は Diff 形式の文字列として返ってくる
    return response.data as unknown as string;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch PR diff: ${error.message}`);
    }
    throw new Error('Failed to fetch PR diff: Unknown error');
  }
}
