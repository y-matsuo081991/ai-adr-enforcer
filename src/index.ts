import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadAdrFiles } from './utils/adrLoader';
import { getPrDiff, postOrUpdateComment, filterDiffNoise } from './utils/github';
import { LlmJudge } from './LlmJudge';

const DIFF_SIZE_LIMIT = 100000;

export async function run(): Promise<void> {
  let failOpen = false;

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
    failOpen = core.getInput('fail_open') === 'true';

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
    const rawPrDiff = await getPrDiff(githubToken, prNumber);
    
    // ADR-003: ノイズのフィルタリング
    const prDiff = filterDiffNoise(rawPrDiff);

    // ADR-003: Diffサイズのハードリミット検証
    if (prDiff.length > DIFF_SIZE_LIMIT) {
      core.warning(`Diff size exceeds the limit (${DIFF_SIZE_LIMIT} chars). Skipping LLM evaluation to prevent token exhaustion and timeouts.`);
      core.info('✅ ADR Check Passed (Skipped due to size limit).');
      return;
    }

    core.info('Data fetching completed. Proceeding to evaluation...');

    // 4. LlmJudge による監査フェーズ
    const judge = new LlmJudge(geminiApiKey);
    const result = await judge.evaluate(adrContent, prDiff);

    // 5. フィードバックフェーズ
    if (result.decision === 'pass') {
      core.info('✅ ADR Check Passed: No architectural violations detected.');
    } else {
      core.info('❌ ADR Violation detected. Posting comment to PR...');
      const commentBody = `## 🚨 Architecture Violation Detected\n\n${result.reasoning}`;
      await postOrUpdateComment(githubToken, prNumber, commentBody);
      
      // CIを失敗させる
      core.setFailed('ADR Violation detected. See PR comment for details.');
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (failOpen) {
      core.warning(`[Fail-Open] Action encountered an error but fail_open is true. Skipping failure: ${errorMessage}`);
    } else {
      core.setFailed(errorMessage);
    }
  }
}

// 直接実行された場合のみ run() を呼ぶ
if (require.main === module) {
  run();
}
