import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../index';
import { loadAdrFiles } from '../utils/adrLoader';
import { 
  getPrDiff, 
  postOrUpdateComment, 
  filterDiffNoise,
  hasChangesRequestedFromHumans,
  submitAutoApproveReview,
  getPrChangedFilesList
} from '../utils/github';
import { LlmJudge } from '../LlmJudge';
import { z } from 'zod';

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
  sanitizeAiResponse: jest.fn((text: string) => text),
  hasChangesRequestedFromHumans: jest.fn(),
  submitAutoApproveReview: jest.fn(),
  getPrChangedFilesList: jest.fn(),
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

  it('6. [ADR-006] Diffサイズが上限を超える場合、原則 Fail-Closed となりCIを落とすこと', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { pull_request: { number: 123 } };
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      if (name === 'fail_open') return 'false'; // デフォルトはFail-Closed
      if (name === 'max_diff_size') return ''; // デフォルト100000を使用
      return 'dummy';
    });
    
    // 100,001文字の巨大なDiffをモックする
    const hugeDiff = 'a'.repeat(100001);
    (getPrDiff as jest.Mock).mockResolvedValue(hugeDiff);

    // Act
    await run();

    // Assert
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Diff size exceeds the limit'));
    expect(mockEvaluate).not.toHaveBeenCalled();
    // 以前は info で pass していたが、ADR 006 により setFailed になるべき
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Diff size exceeds the limit'));
  });

  it('7. [ADR-005] PRに bypass-adr ラベルが付いている場合、監査をスキップしてPassすること', async () => {
    // Arrange
    github.context.eventName = 'pull_request';
    github.context.payload = { 
      pull_request: { 
        number: 123,
        labels: [{ name: 'bug' }, { name: 'bypass-adr' }] // bypassラベルを付与
      } 
    };

    // Act
    await run();

    // Assert
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('ADR Check skipped due to "bypass-adr" label'));
    expect(core.getInput).not.toHaveBeenCalled(); // 早期リターンによりInputも取得しない
    expect(loadAdrFiles).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  describe('Hybrid Auto-Approve & 2-Step Audit Policies (ADR 012)', () => {
    beforeEach(() => {
      github.context.eventName = 'pull_request';
      github.context.payload = { pull_request: { number: 123 } };

      // デフォルトのInputモックを設定
      (core.getInput as jest.Mock).mockImplementation((name: string) => {
        if (name === 'github_token') return 'dummy-token';
        if (name === 'gemini_api_key') return 'dummy-key';
        if (name === 'adr_directory') return 'docs/adr';
        if (name === 'fail_open') return 'false';
        if (name === 'auto_approve') return 'true'; // 自動承認有効化
        if (name === 'auto_approve_max_lines') return '30';
        return '';
      });

      // 新規GitHubヘルパーのデフォルトモック
      (hasChangesRequestedFromHumans as jest.Mock).mockResolvedValue(false);
      (getPrChangedFilesList as jest.Mock).mockResolvedValue(['src/index.ts']);
    });

    it('8. auto_approveがtrueで、変更が小さく(30行以下)且つAIリスクがlowの場合、PRを自動的に承認すること', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;'; // 1行の変更
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      mockEvaluate.mockResolvedValue({ decision: 'pass', reasoning: 'Safe changes', risk_level: 'low' });

      // Act
      await run();

      // Assert
      expect(submitAutoApproveReview).toHaveBeenCalledWith('dummy-token', 123);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Approved'));
    });

    it('9. auto_approveがtrueだが、人間が CHANGES_REQUESTED レビューを残している場合、自動承認をスキップすること（人間の決定の絶対尊重）', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      mockEvaluate.mockResolvedValue({ decision: 'pass', reasoning: 'Safe changes', risk_level: 'low' });
      
      // 人間が却下している状態
      (hasChangesRequestedFromHumans as jest.Mock).mockResolvedValue(true);

      // Act
      await run();

      // Assert
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Skipping auto-approve due to human CHANGES_REQUESTED'));
    });

    it('10. auto_approveがtrueだが、変更行数がしきい値を超える巨大PRの場合、自動承認はスキップするが、2ステップ監査を実行すること', async () => {
      // Arrange
      // 35行のプログラム変更（しきい値30を超える）
      const largeDiff = '+\n'.repeat(35);
      (getPrDiff as jest.Mock).mockResolvedValue(largeDiff);
      
      (getPrChangedFilesList as jest.Mock).mockResolvedValue(['src/index.ts', 'src/utils/github.ts']);
      mockEvaluate.mockResolvedValue({ decision: 'pass', reasoning: 'Safe but huge' });

      // Act
      await run();

      // Assert
      // 巨大PRのため自動Approveは行われないこと
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      // 2ステップ監査（全体目次インプット ➔ 個別監査）がトリガーされていることをログ等で確認
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Executing world-standard 2-step audit for large PR'));
    });
  });
});
