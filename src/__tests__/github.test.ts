import * as github from '@actions/github';
import { 
  getPrDiff, 
  postOrUpdateComment, 
  filterDiffNoise, 
  sanitizeAiResponse,
  hasChangesRequestedFromHumans,
  submitAutoApproveReview,
  getPrChangedFilesList
} from '../utils/github';

// Octokitのモック設定
const mockGetPullRequest = jest.fn();
const mockListComments = jest.fn();
const mockCreateComment = jest.fn();
const mockUpdateComment = jest.fn();
const mockListReviews = jest.fn();
const mockCreateReview = jest.fn();
const mockListFiles = jest.fn();
const mockPaginate = jest.fn();

jest.mock('@actions/github', () => ({
  getOctokit: jest.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        get: mockGetPullRequest,
        listReviews: mockListReviews,
        createReview: mockCreateReview,
        listFiles: mockListFiles,
      },
      issues: {
        listComments: mockListComments,
        createComment: mockCreateComment,
        updateComment: mockUpdateComment,
      }
    },
    paginate: mockPaginate,
  })),
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('sanitizeAiResponse (ADR-009)', () => {
  it('1. Markdownの画像タグがバッククォートで無効化されること', () => {
    const input = 'This is an image ![malicious image](http://attacker.com/img.png) here.';
    const expected = 'This is an image `[IMAGE: malicious image](http://attacker.com/img.png)` here.';
    expect(sanitizeAiResponse(input)).toBe(expected);
  });

  it('2. Markdownのリンクタグがバッククォートで無効化されること', () => {
    const input = 'Click [here](https://phishing.example.com) to login.';
    const expected = 'Click `[LINK: here](https://phishing.example.com)` to login.';
    expect(sanitizeAiResponse(input)).toBe(expected);
  });

  it('3. むき出しのURLがバッククォートで無効化されること', () => {
    const input = 'Visit https://malware.com for details or http://bad.org.';
    const expected = 'Visit `https://malware.com` for details or `http://bad.org`.';
    expect(sanitizeAiResponse(input)).toBe(expected);
  });

  it('4. 複数のインジェクションが混在していてもすべて無効化されること', () => {
    const input = 'Check ![img](http://a.com) and [link](https://b.com) and http://c.com.';
    const expected = 'Check `[IMAGE: img](http://a.com)` and `[LINK: link](https://b.com)` and `http://c.com`.';
    expect(sanitizeAiResponse(input)).toBe(expected);
  });
});

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

  it('2. [ADR-011] Case-Insensitiveで拡張子（例: .PNG, .Jpg）を除外できること', () => {
    const rawDiff = `diff --git a/public/logo.PNG b/public/logo.PNG
index 123..456
--- a/public/logo.PNG
+++ b/public/logo.PNG
@@ -1,2 +1,2 @@
-<img/>
+<img width="10"/>
diff --git a/public/photo.Jpg b/public/photo.Jpg
index abc..def
--- a/public/photo.Jpg
+++ b/public/photo.Jpg
@@ -1,2 +1,2 @@
-<img/>
+<img width="10"/>
diff --git a/src/index.ts b/src/index.ts
index abc..def
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,2 +1,3 @@
 console.log("test");
`;

    const filtered = filterDiffNoise(rawDiff);

    expect(filtered).not.toContain('public/logo.PNG');
    expect(filtered).not.toContain('public/photo.Jpg');
    expect(filtered).toContain('src/index.ts');
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

  it('1. 過去のAIコメントが存在しない場合、新規でコメントを作成し免責事項が含まれること', async () => {
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
    // ADR-009 Disclaimer check
    expect(mockCreateComment).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('Disclaimer'),
    }));
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

describe('hasChangesRequestedFromHumans', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. 人間の CHANGES_REQUESTED レビューが1つでも存在すれば true を返すこと', async () => {
    // Arrange
    mockListReviews.mockResolvedValue({
      data: [
        { state: 'APPROVED', user: { type: 'User', login: 'human1' } },
        { state: 'CHANGES_REQUESTED', user: { type: 'User', login: 'human2' } },
      ],
    });

    // Act
    const result = await hasChangesRequestedFromHumans('token', 123);

    // Assert
    expect(result).toBe(true);
    expect(mockListReviews).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
    });
  });

  it('2. CHANGES_REQUESTED レビューが存在しても、それが Bot によるものの場合は false を返すこと', async () => {
    // Arrange
    mockListReviews.mockResolvedValue({
      data: [
        { state: 'CHANGES_REQUESTED', user: { type: 'Bot', login: 'some-bot[bot]' } },
      ],
    });

    // Act
    const result = await hasChangesRequestedFromHumans('token', 123);

    // Assert
    expect(result).toBe(false);
  });

  it('3. CHANGES_REQUESTED レビューが一切存在しない場合は false を返すこと', async () => {
    // Arrange
    mockListReviews.mockResolvedValue({
      data: [
        { state: 'APPROVED', user: { type: 'User', login: 'human1' } },
        { state: 'COMMENTED', user: { type: 'User', login: 'human2' } },
      ],
    });

    // Act
    const result = await hasChangesRequestedFromHumans('token', 123);

    // Assert
    expect(result).toBe(false);
  });
});

describe('submitAutoApproveReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. PRに APPROVED レビューを正常に作成して投稿すること', async () => {
    // Arrange
    mockCreateReview.mockResolvedValue({ data: { id: 777 } });

    // Act
    await submitAutoApproveReview('token', 123);

    // Assert
    expect(mockCreateReview).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 123,
      event: 'APPROVE',
      body: expect.stringContaining('Auto-approved'),
    });
  });
});

describe('getPrChangedFilesList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. 変更されたファイルの一覧を正常に取得できること', async () => {
    // Arrange
    const mockFilesData = [
      { filename: 'src/index.ts' },
      { filename: 'src/utils/github.ts' },
    ];
    // mockPaginate の実装をコールバック対応にする
    mockPaginate.mockImplementationOnce(async (apiMethod, params, callback) => {
      const response = { data: mockFilesData };
      if (callback) {
        const done = jest.fn();
        callback(response, done);
      }
      return mockFilesData;
    });

    // Act
    const files = await getPrChangedFilesList('token', 123);

    // Assert
    expect(files).toEqual(['src/index.ts', 'src/utils/github.ts']);
    expect(mockPaginate).toHaveBeenCalledWith(
      mockListFiles,
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
      }),
      expect.any(Function)
    );
  });

  it('2. 変更ファイル数が500を超える場合、防衛境界ルールにより例外をスローすること', async () => {
    // Arrange
    // mockPaginate の呼び出し時に、callbackを実行して500件以上にする、または
    // 実際に paginate の処理を模擬してエラーがスローされるようにする。
    // ここでは、mockPaginate のコールバック関数を取得して呼び出す。
    mockPaginate.mockImplementation(async (apiMethod, params, callback) => {
      // 501個のファイルをコールバックに渡す
      const largePage = {
        data: Array.from({ length: 501 }, (_, i) => ({ filename: `file${i}.ts` })),
      };
      if (callback) {
        const done = jest.fn();
        callback(largePage, done);
      }
      return largePage.data;
    });

    // Act & Assert
    await expect(getPrChangedFilesList('token', 123)).rejects.toThrow(
      'PR exceeds maximum allowed files limit (500).'
    );
  });
});

