import * as github from '@actions/github';
import { getPrDiff } from '../utils/github';

// Octokitのモック設定
const mockGetPullRequest = jest.fn();
jest.mock('@actions/github', () => ({
  getOctokit: jest.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        get: mockGetPullRequest,
      },
    },
  })),
  context: {
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

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
    expect(mockGetPullRequest).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: prNumber,
      mediaType: {
        format: 'diff', // diff フォーマットを指定しているか検証
      },
    });
    expect(diff).toBe(expectedDiff);
  });

  it('2. APIエラーが発生した場合、エラーをスローすること', async () => {
    // Arrange
    mockGetPullRequest.mockRejectedValue(new Error('API Rate Limit Exceeded'));

    // Act & Assert
    await expect(getPrDiff('token', 123)).rejects.toThrow('Failed to fetch PR diff: API Rate Limit Exceeded');
  });
});
