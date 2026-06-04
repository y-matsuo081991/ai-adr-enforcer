import * as github from '@actions/github';
import { getPrDiff, postOrUpdateComment, filterDiffNoise } from '../utils/github';

// Octokitのモック設定
const mockGetPullRequest = jest.fn();
const mockListComments = jest.fn();
const mockCreateComment = jest.fn();
const mockUpdateComment = jest.fn();

jest.mock('@actions/github', () => ({
  getOctokit: jest.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        get: mockGetPullRequest,
      },
      issues: {
        listComments: mockListComments,
        createComment: mockCreateComment,
        updateComment: mockUpdateComment,
      }
    },
  })),
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('filterDiffNoise', () => {
  it('1. package-lock.json や .svg などの自動生成・バイナリファイルのDiffチャンクを除外できること', () => {
    const rawDiff = `diff --git a/package-lock.json b/package-lock.json
index 123..456
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
 {
-  "version": "1.0.0"
+  "version": "1.0.1"
 }
diff --git a/src/index.ts b/src/index.ts
index abc..def
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,2 +1,3 @@
 console.log("hello");
+console.log("world");
diff --git a/public/icon.svg b/public/icon.svg
index 789..012
--- a/public/icon.svg
+++ b/public/icon.svg
@@ -1,2 +1,2 @@
-<svg></svg>
+<svg width="10"></svg>
`;

    const filtered = filterDiffNoise(rawDiff);

    expect(filtered).not.toContain('package-lock.json');
    expect(filtered).not.toContain('public/icon.svg');
    expect(filtered).toContain('src/index.ts');
    expect(filtered).toContain('console.log("world");');
  });
});

describe('getPrDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Octokitを使用してPRのDiff文字列を正常に取得できること', async () => {
    // Arrange
    const dummyToken = 'dummy-token';
    const prNumber = 123;
    const expectedDiff = '+ const newFeature = true;';
    
    // GitHub API が diff の文字列（data）を返すとモックする
    mockGetPullRequest.mockResolvedValue({
      data: expectedDiff,
    });

    // Act
    const diff = await getPrDiff(dummyToken, prNumber);

    // Assert
    expect(github.getOctokit).toHaveBeenCalledWith(dummyToken);
    expect(mockGetPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: prNumber,
      mediaType: {
        format: 'diff', // diff フォーマットを指定しているか検証
      },
    }));
    expect(diff).toBe(expectedDiff);
  });

  it('2. APIエラーが発生した場合、エラーをスローすること', async () => {
    // Arrange
    mockGetPullRequest.mockRejectedValue(new Error('API Rate Limit Exceeded'));

    // Act & Assert
    await expect(getPrDiff('token', 123)).rejects.toThrow('Failed to fetch PR diff: API Rate Limit Exceeded');
  });

  it('3. OctokitのAPIリクエストにタイムアウト（request.signal）が設定されていること', async () => {
    // Arrange
    const dummyToken = 'dummy-token';
    const prNumber = 123;
    mockGetPullRequest.mockResolvedValue({ data: 'diff' });

    // Act
    await getPrDiff(dummyToken, prNumber);

    // Assert
    expect(mockGetPullRequest).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    }));
  });
});

describe('postOrUpdateComment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. 過去のAIコメントが存在しない場合、新規でコメントを作成すること', async () => {
    // Arrange
    mockListComments.mockResolvedValue({ data: [] }); // 既存コメントなし

    // Act
    await postOrUpdateComment('token', 123, 'New Violation Detected');

    // Assert
    expect(mockListComments).toHaveBeenCalled();
    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 123,
      body: expect.stringContaining('New Violation Detected'),
    });
    expect(mockUpdateComment).not.toHaveBeenCalled();
  });

  it('2. 過去のAIコメントが存在する場合、そのコメントIDを指定して更新すること', async () => {
    // Arrange
    const existingCommentId = 999;
    mockListComments.mockResolvedValue({
      data: [
        { id: 111, body: 'Human comment' },
        { id: existingCommentId, body: 'Old AI comment\n<!-- ai-adr-enforcer-signature -->' },
      ]
    });

    // Act
    await postOrUpdateComment('token', 123, 'Updated Violation Detected');

    // Assert
    expect(mockCreateComment).not.toHaveBeenCalled();
    expect(mockUpdateComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: existingCommentId,
      body: expect.stringContaining('Updated Violation Detected'),
    });
  });
});

