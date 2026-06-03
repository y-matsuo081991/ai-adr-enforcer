import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../index';
import { loadAdrFiles } from '../utils/adrLoader';
import { getPrDiff } from '../utils/github';

// モックの設定
jest.mock('@actions/core');
jest.mock('@actions/github', () => ({
  context: {
    eventName: '',
    payload: {},
  },
}));
jest.mock('../utils/adrLoader');
jest.mock('../utils/github');

describe('Action Entrypoint (index.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadAdrFiles as jest.Mock).mockReturnValue('Mocked ADR Content');
    (getPrDiff as jest.Mock).mockResolvedValue('Mocked PR Diff');
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
    expect(getPrDiff).not.toHaveBeenCalled();
  });

  it('2. pull_requestイベントの場合、必要なデータの取得処理（ADRとDiff）を実行すること', async () => {
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

    // Act
    await run();

    // Assert
    expect(core.getInput).toHaveBeenCalledWith('github_token', { required: true });
    expect(core.getInput).toHaveBeenCalledWith('adr_directory', { required: true });

    // Privacy（マスキング）の検証
    expect(core.setSecret).toHaveBeenCalledWith('dummy-github-token');

    // データの取得処理が正しく引数を渡されて呼ばれること
    expect(loadAdrFiles).toHaveBeenCalledWith('docs/adr');
    expect(getPrDiff).toHaveBeenCalledWith('dummy-github-token', 123);

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Data fetching completed'));
  });
});
