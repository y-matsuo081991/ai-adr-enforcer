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
  getPrChangedFilesList,
  hasUnresolvedComments,
  getHumanGeneralComments
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
  hasUnresolvedComments: jest.fn(),
  getHumanGeneralComments: jest.fn(),
}));
jest.mock('../LlmJudge');

describe('Action Entrypoint (index.ts)', () => {
  let mockEvaluate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (loadAdrFiles as jest.Mock).mockReturnValue('Mocked ADR Content');
    (getPrDiff as jest.Mock).mockResolvedValue('Mocked PR Diff');
    (getHumanGeneralComments as jest.Mock).mockResolvedValue([]);
    
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
    expect(mockEvaluate).toHaveBeenCalledWith('Mocked ADR Content', 'Mocked PR Diff', []);
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
      (hasUnresolvedComments as jest.Mock).mockResolvedValue(false);
      (getHumanGeneralComments as jest.Mock).mockResolvedValue([]);
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

    it('10. auto_approveがtrueだが、変更行数がしきい値を超える巨大PRの場合、自動承認はスキップするが、一括監査を実行すること', async () => {
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
      // 一括監査がトリガーされていることをログ等で確認
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Executing single-request consolidated audit for large PR'));
    });

    it('11. 人間が過去に残した指摘コメントが未解決の場合、自動承認をスキップし、Remediation Adviceコメントを投稿すること', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      
      // 人間の過去コメントが存在する状態にする
      const humanComments = ['Please use Google Fonts (Outfit) instead of system default font.'];
      (getHumanGeneralComments as jest.Mock).mockResolvedValue(humanComments);

      // LlmJudge が未解決 (unresolved) と判定し、アドバイスを返す
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'Changes are fine but human comment is not addressed yet.', 
        risk_level: 'low',
        remediation_status: 'unresolved',
        remediation_advice: 'The UI still uses system fonts. Please import Google Fonts (Outfit) and use it.'
      });

      // Act
      await run();

      // Assert
      // 自動承認はスキップされていること
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      // Remediation Advice を含むコメントがPRに投稿されていること
      expect(postOrUpdateComment).toHaveBeenCalledWith(
        'dummy-token', 
        123, 
        expect.stringContaining('The UI still uses system fonts. Please import Google Fonts (Outfit) and use it.')
      );
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Skipping auto-approve due to unresolved human comments'));
    });

    it('12. 人間の指摘コメントが存在するが、それらがすべて解決済(resolved)と判定された場合、正常に自動承認されること', async () => {
      // Arrange
      const smallDiff = '+ body { font-family: "Outfit", sans-serif; }';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      
      // 人間の過去コメントが存在する
      const humanComments = ['Please use Google Fonts (Outfit) instead of system default font.'];
      (getHumanGeneralComments as jest.Mock).mockResolvedValue(humanComments);

      // LlmJudge が解決済 (resolved) と判定
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'The human comment is successfully addressed in the new diff.', 
        risk_level: 'low',
        remediation_status: 'resolved',
        remediation_advice: null
      });

      // Act
      await run();

      // Assert
      // 正常に自動承認されること
      expect(submitAutoApproveReview).toHaveBeenCalledWith('dummy-token', 123);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Approved'));
    });

    it('13. auto_approveがtrueだが、AIリスクレベルがmediumまたはhighの場合、自動承認をスキップすること', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      
      // リスクレベルが medium
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'Changes are syntactically valid but require human verification.', 
        risk_level: 'medium',
        remediation_status: 'no_human_comments',
        remediation_advice: null
      });

      // Act
      await run();

      // Assert
      // 自動承認はスキップされていること
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      // ログにリスクレベルによるスキップが記録されていること
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Skipping auto-approve due to risk level: medium'));
    });

    it('14. auto_approveがtrueで、変更が30行を超えているが、すべて安全なファイルのみの変更の場合、自動承認されること（静的オプトアウト回避）', async () => {
      // Arrange
      // 35行の変更（しきい値30を超える）
      const largeDiff = '+\n'.repeat(35);
      (getPrDiff as jest.Mock).mockResolvedValue(largeDiff);
      
      // 変更ファイルは README.md（安全なファイル）
      (getPrChangedFilesList as jest.Mock).mockResolvedValue(['README.md']);
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'Markdown only changes', 
        risk_level: 'low',
        remediation_status: 'no_human_comments'
      });

      // Act
      await run();

      // Assert
      // 30行を超えているが、安全なファイルのみなので自動承認される
      expect(submitAutoApproveReview).toHaveBeenCalledWith('dummy-token', 123);
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('[Auto-Approve Audit Log]'));
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Is Safe Files Only: true'));
    });

    it('15. リスクレベルがmediumの場合、自動承認がスキップされ、Audit Logに SKIP 理由が明記されること', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      (getPrChangedFilesList as jest.Mock).mockResolvedValue(['src/index.ts']);
      
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'Changes are fine but high risk', 
        risk_level: 'medium',
        remediation_status: 'no_human_comments'
      });

      // Act
      await run();

      // Assert
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('[Auto-Approve Audit Log]'));
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('- AI Risk Level: medium -> SKIP'));
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('- Result: Skipped (Risk Level: medium)'));
    });

    it('16. auto_approveがtrueでAIがresolvedと判定しても、GitHub上に物理的な未解決コメントスレッドが残っている場合、自動承認をスキップすること（スレッド状態の物理的チェック）', async () => {
      // Arrange
      const smallDiff = '+ const a = 1;';
      (getPrDiff as jest.Mock).mockResolvedValue(smallDiff);
      (getPrChangedFilesList as jest.Mock).mockResolvedValue(['src/index.ts']);
      
      // 物理スレッドが未解決の状態
      (hasUnresolvedComments as jest.Mock).mockResolvedValue(true);

      // AIは resolved / low リスクと判定（AI判定と物理状態の乖離）
      mockEvaluate.mockResolvedValue({ 
        decision: 'pass', 
        reasoning: 'Changes look resolved to me', 
        risk_level: 'low',
        remediation_status: 'resolved'
      });

      // Act
      await run();

      // Assert
      // 物理スレッドが未解決のため、自動承認は行われないこと
      expect(submitAutoApproveReview).not.toHaveBeenCalled();
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Skipping auto-approve due to unresolved physical comment threads'));
      expect(core.info).toHaveBeenCalledWith(expect.stringContaining('- Result: Skipped (Unresolved physical comment threads exist)'));
    });
  });
});
