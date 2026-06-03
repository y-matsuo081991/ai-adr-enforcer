import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from '../index';

// モックの設定
jest.mock('@actions/core');
jest.mock('@actions/github', () => ({
  context: {
    eventName: '',
    payload: {},
  },
}));

describe('Action Entrypoint (index.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. pull_requestイベント以外で実行された場合は、情報をログ出力して早期リターンすること', async () => {
    // Arrange
    github.context.eventName = 'push'; // PR以外

    // Act
    await run();

    // Assert
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('only runs on pull_request events'));
    expect(core.getInput).not.toHaveBeenCalled();
  });

  it('2. pull_requestイベントの場合、必要なInputsを受け取り、シークレットとして登録すること', async () => {
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
    expect(core.getInput).toHaveBeenCalledWith('gemini_api_key', { required: true });
    expect(core.getInput).toHaveBeenCalledWith('adr_directory', { required: true });

    expect(core.setSecret).toHaveBeenCalledWith('dummy-github-token');
    expect(core.setSecret).toHaveBeenCalledWith('dummy-gemini-key');

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('Processing PR #123'));
  });
});
