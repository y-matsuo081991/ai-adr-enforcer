import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../index';
import { loadAdrFiles } from '../utils/adrLoader';
import { getPrDiff, postOrUpdateComment, filterDiffNoise } from '../utils/github';
import { LlmJudge } from '../LlmJudge';

// モックの設定
jest.mock('@actions/core');
jest.mock('@actions/github', () => ({
  context: {
    eventName: '',
    payload: {},
  },
}));
jest.mock('../utils/adrLoader');
jest.mock('../utils/github', () => ({
  getPrDiff: jest.fn(),
  postOrUpdateComment: jest.fn(),
  filterDiffNoise: jest.fn((diff: string) => diff),
}));
jest.mock('../LlmJudge');

describe('Action Entrypoint (index.ts)', () => {
  let mockEvaluate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (loadAdrFiles as jest.Mock).mockReturnValue('Mocked ADR Content');
    (getPrDiff as jest.Mock).mockResolvedValue('Mocked PR Diff');
    
    mockEvaluate = jest.fn();
    (LlmJudge as jest.Mock).mockImplementation(() => ({
      evaluate: mockEvaluate,
    }));
  });

  it('1. pull_requestイベント以外で実行された場合は、情報をログ出力して早期リターンすること', async () => {
    // Arrange
    github.context.eventName = 'push'; // PR以外

    // Act
    await run();

    // Assert
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('only runs on pull_request events'));
    expect(core.getInput).not.toHaveBeenCalled();
    expect(loadAdrFiles).not.toHaveBeenCalled();
  });

  it('2. 監査結果が "pass" の場合、コメントを投稿せずに正常終了すること', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'github_token') return 'dummy-github-token';
      if (name === 'gemini_api_key') return 'dummy-gemini-key';
      if (name === 'adr_directory') return 'docs/adr';
      if (name === 'fail_open') return 'false';
      return '';
    });

    mockEvaluate.mockResolvedValue({ decision: 'pass', reasoning: 'All good' });

    // Act
    await run();

    // Assert
    expect(LlmJudge).toHaveBeenCalledWith('dummy-gemini-key');
    expect(mockEvaluate).toHaveBeenCalledWith('Mocked ADR Content', 'Mocked PR Diff');
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('ADR Check Passed'));
    expect(postOrUpdateComment).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('3. 監査結果が "fail" の場合、PRにコメントを投稿し、setFailedでCIを落とすこと', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };
    (core.getInput as jest.Mock).mockReturnValue('dummy');
    
    const violationReason = 'Violation: MySQL is used.';
    mockEvaluate.mockResolvedValue({ decision: 'fail', reasoning: violationReason });

    // Act
    await run();

    // Assert
    const expectedComment = `## 🚨 Architecture Violation Detected\n\n${violationReason}`;
    expect(postOrUpdateComment).toHaveBeenCalledWith('dummy', 123, expectedComment);
    expect(core.setFailed).toHaveBeenCalledWith('ADR Violation detected. See PR comment for details.');
  });

  it('4. エラー発生時、fail_open=true の場合は warning のみでスルーすること（フェイルセーフ）', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };
    
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'fail_open') return 'true'; // フェイルセーフ有効
      return 'dummy';
    });

    // APIエラーをシミュレート
    mockEvaluate.mockRejectedValue(new Error('Gemini API Timeout'));

    // Act
    await run();

    // Assert
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Gemini API Timeout'));
    expect(core.setFailed).not.toHaveBeenCalled(); // CIは落ちないこと
  });

  it('5. エラー発生時、fail_open=false の場合は setFailed でCIを落とすこと', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };
    
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'fail_open') return 'false'; // フェイルセーフ無効
      return 'dummy';
    });

    mockEvaluate.mockRejectedValue(new Error('Gemini API Timeout'));

    // Act
    await run();

    // Assert
    expect(core.setFailed).toHaveBeenCalledWith('Gemini API Timeout');
  });

  it('6. Diffサイズが上限(100,000文字)を超える場合、LLM評価をスキップして警告とともにPass扱いとすること', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };
    (core.getInput as jest.Mock).mockReturnValue('dummy');
    
    // 100,001文字の巨大なDiffをモックする
    const hugeDiff = 'a'.repeat(100001);
    (getPrDiff as jest.Mock).mockResolvedValue(hugeDiff);

    // Act
    await run();

    // Assert
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Diff size exceeds the limit'));
    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('✅ ADR Check Passed'));
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
