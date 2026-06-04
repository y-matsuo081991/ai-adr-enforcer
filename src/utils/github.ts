import * as github from '@actions/github';

// AIが投稿したコメントを識別するための隠しマーカー
const SIGNATURE = '<!-- ai-adr-enforcer-signature -->';

/**
 * Diffのノイズとなる自動生成ファイルやバイナリファイルのチャンクを除外します。
 * 
 * @param diff 生のPR Diff文字列
 * @returns フィルタリングされたDiff文字列
 */
export function filterDiffNoise(diff: string): string {
  // 除外対象のファイル拡張子またはファイル名のパターン
  const excludePatterns = [
    'package-lock\\.json',
    'yarn\\.lock',
    'pnpm-lock\\.yaml',
    '\\.svg$',
    '\\.png$',
    '\\.jpg$',
    '\\.map$',
  ];
  
  const excludeRegex = new RegExp(`diff --git a/.* b/.*(${excludePatterns.join('|')})`, 'i');
  
  // diffの各ファイルごとのチャンクを分割 ('diff --git' で始まる)
  const chunks = diff.split(/(?=^diff --git )/m);
  
  // パターンにマッチしないチャンクだけを残す
  const filteredChunks = chunks.filter(chunk => {
    // 最初の行をチェックして除外パターンに一致するか確認
    const firstLine = chunk.split('\n')[0] || '';
    return !excludeRegex.test(firstLine);
  });
  
  return filteredChunks.join('');
}

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
      request: {
        // ADR-003: タイムアウト設定 (30,000ms)
        signal: AbortSignal.timeout(30000),
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

/**
 * Pull Request にコメントを投稿します。
 * スパム防止のため、以前にこのアクションが投稿したコメントが存在する場合は新規投稿ではなく更新（上書き）します。
 * 
 * @param token GitHub Token
 * @param prNumber 対象のPull Request番号
 * @param body コメントの本文（監査結果など）
 */
export async function postOrUpdateComment(token: string, prNumber: number, body: string): Promise<void> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  // コメントの末尾に署名を追加
  const commentBody = `${body}\n\n${SIGNATURE}`;

  try {
    // 既存のコメント一覧を取得
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    });

    // 署名を持つ既存のコメントを探す
    const existingComment = comments.find((comment) => comment.body?.includes(SIGNATURE));

    if (existingComment) {
      // 既存のコメントがあれば更新する
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingComment.id,
        body: commentBody,
      });
    } else {
      // なければ新規作成する
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: commentBody,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to post or update comment: ${error.message}`);
    }
    throw new Error('Failed to post or update comment: Unknown error');
  }
}
