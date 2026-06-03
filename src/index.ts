import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadAdrFiles } from './utils/adrLoader';
import { getPrDiff } from './utils/github';

export async function run(): Promise<void> {
  try {
    const context = github.context;

    // 1. PRイベント以外で実行された場合は早期リターン
    if (context.eventName !== 'pull_request') {
      core.info('This action only runs on pull_request events. Skipping.');
      return;
    }

    // 2. Inputs の受け取り
    const githubToken = core.getInput('github_token', { required: true });
    const geminiApiKey = core.getInput('gemini_api_key', { required: true });
    const adrDirectory = core.getInput('adr_directory', { required: true });
    const failOpen = core.getInput('fail_open') === 'true';

    // 【NFR: Privacy】 ログ出力のマスキング機能 (Sensitive Data Masking)
    core.setSecret(githubToken);
    core.setSecret(geminiApiKey);

    const prNumber = context.payload.pull_request?.number;
    if (!prNumber) {
      throw new Error('Pull Request number is missing from the context.');
    }

    core.info(`Processing PR #${prNumber} with ADRs from ${adrDirectory}...`);
    
    // 3. データ取得フェーズ
    const adrContent = loadAdrFiles(adrDirectory);
    const prDiff = await getPrDiff(githubToken, prNumber);

    core.info('Data fetching completed. Proceeding to evaluation...');

    // TODO: LlmJudge による監査
    // TODO: 違反時の Review Comment 投稿と setFailed

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

// 直接実行された場合のみ run() を呼ぶ
if (require.main === module) {
  run();
}
