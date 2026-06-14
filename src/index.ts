import * as core from '@actions/core';
import * as github from '@actions/github';
import { loadAdrFiles } from './utils/adrLoader';
import { 
  getPrDiff, 
  postOrUpdateComment, 
  filterDiffNoise, 
  sanitizeAiResponse,
  hasChangesRequestedFromHumans,
  submitAutoApproveReview,
  getPrChangedFilesList,
  hasUnresolvedComments
} from './utils/github';
import { LlmJudge } from './LlmJudge';

/**
 * 差分（Diff）テキストから変更行（追加・削除行）の数をカウントします。
 * 
 * @param diff PRのDiff文字列
 * @returns 変更行数の合計
 */
function countChangedLines(diff: string): number {
  const lines = diff.split('\n');
  let count = 0;
  for (const line of lines) {
    if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) {
      count++;
    }
  }
  return count;
}

/**
 * 全体のDiffから、特定のファイルに関連する差分（パッチ）を抽出します。
 * 
 * @param fullDiff PR全体のDiff文字列
 * @param filepath 対象ファイルのパス
 * @returns ファイル固有のDiff文字列
 */
function extractFileDiff(fullDiff: string, filepath: string): string {
  const lines = fullDiff.split('\n');
  let inTarget = false;
  const fileLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (line.includes(`a/${filepath}`) || line.includes(`b/${filepath}`)) {
        inTarget = true;
        fileLines.push(line);
      } else {
        inTarget = false;
      }
    } else if (inTarget) {
      fileLines.push(line);
    }
  }
  return fileLines.join('\n');
}

export async function run(): Promise<void> {
  const startTime = Date.now();
  const GLOBAL_TIMEOUT_MS = 180000; // 180秒（3分）
  const TIMEOUT_BUFFER_MS = 10000;  // 170秒でタイムアウト間近と判定
  
  let failOpen = false;

  try {
    const context = github.context;

    // 1. PRイベント以外で実行された場合は早期リターン
    if (context.eventName !== 'pull_request') {
      core.info('This action only runs on pull_request events. Skipping.');
      return;
    }

    // ADR-005: 脱出ハッチ (Escape Hatch)
    const labels = context.payload.pull_request?.labels?.map((l: any) => l.name) || [];
    if (labels.includes('bypass-adr')) {
      core.info('✅ ADR Check skipped due to "bypass-adr" label. Forcing Pass.');
      return;
    }

    // 2. Inputs の受け取り
    const githubToken = core.getInput('github_token', { required: true });
    const geminiApiKey = core.getInput('gemini_api_key', { required: true });
    const adrDirectory = core.getInput('adr_directory', { required: true });
    failOpen = core.getInput('fail_open') === 'true';
    const maxDiffSizeInput = core.getInput('max_diff_size');
    const maxDiffSize = maxDiffSizeInput ? parseInt(maxDiffSizeInput, 10) : 100000;
    
    // ADR 012: 自動承認（Hybrid Auto-Approve）用のInputs
    const autoApprove = core.getInput('auto_approve') === 'true';
    const autoApproveMaxLinesInput = core.getInput('auto_approve_max_lines');
    const autoApproveMaxLines = autoApproveMaxLinesInput ? parseInt(autoApproveMaxLinesInput, 10) : 30;

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

    // ADR-006: Diffサイズのハードリミット検証 (Fail-Closed default)
    if (prDiff.length > maxDiffSize) {
      const msg = `Diff size exceeds the limit (${maxDiffSize} chars). Skipping LLM evaluation to prevent token exhaustion.`;
      core.warning(msg);
      if (failOpen) {
        core.info('✅ ADR Check Passed (Fail-Open active).');
        return;
      } else {
        throw new Error(msg); // Fail-Closed
      }
    }

    const changedLines = countChangedLines(prDiff);
    core.info(`PR change stats: ${changedLines} lines of code modified.`);

    const judge = new LlmJudge(geminiApiKey);

    // 4. LlmJudge による監査フェーズ (分岐判定)
    if (autoApprove && changedLines > autoApproveMaxLines) {
      // 巨大PR向け：世界標準2ステップ監査
      core.info('Executing world-standard 2-step audit for large PR');
      
      const changedFiles = await getPrChangedFilesList(githubToken, prNumber);
      
      let globalTimeoutTriggered = false;
      const violations: string[] = [];
      const suggestions: string[] = [];

      for (const file of changedFiles) {
        // グローバルタイムアウト検証 (180秒予算の厳守)
        if (Date.now() - startTime > (GLOBAL_TIMEOUT_MS - TIMEOUT_BUFFER_MS)) {
          core.warning('[Timeout Fallback] Global 180s limit is approaching. Terminating further audits and posting current findings.');
          globalTimeoutTriggered = true;
          break;
        }

        let fileDiff = extractFileDiff(prDiff, file);
        if (!fileDiff && prDiff) {
          // テストのモック等のために diff --git がない場合は全体の diff でフォールバック
          fileDiff = prDiff;
        }

        if (fileDiff.trim()) {
          const result = await judge.evaluate(adrContent, fileDiff);
          if (result.decision === 'fail') {
            violations.push(`**File: \`${file}\`**\n${result.reasoning}`);
            if (result.suggestion) {
              suggestions.push(`**File: \`${file}\`**\n\`\`\`suggestion\n${result.suggestion}\n\`\`\``);
            }
          }
        }
      }

      if (violations.length > 0) {
        core.info('❌ ADR Violation detected on large PR. Posting comment...');
        let commentBody = `## 🚨 Architecture Violation Detected (Large PR 2-Step Audit)\n\n${violations.join('\n\n')}`;
        if (suggestions.length > 0) {
          commentBody += `\n\n### 💡 Auto-remediation Suggestion\n\n${suggestions.join('\n\n')}`;
        }
        await postOrUpdateComment(githubToken, prNumber, commentBody);

        if (globalTimeoutTriggered) {
          // タイムアウト時は縮退運転としてCIを正常終了させる (ADR 012)
          core.warning('[Timeout Degraded] Action finished with violations, but returned SUCCESS due to strict 180s timeout budget.');
        } else {
          core.setFailed('ADR Violation detected. See PR comment for details.');
        }
      } else {
        core.info('✅ ADR Check Passed: No architectural violations detected in 2-step large PR audit.');
      }
    } else {
      // 通常規模PRの通常監査、あるいは自動承認が無効な場合の既存フロー
      core.info('Data fetching completed. Proceeding to evaluation...');
      const result = await judge.evaluate(adrContent, prDiff);

      // 5. フィードバックフェーズ
      if (result.decision === 'pass') {
        core.info('✅ ADR Check Passed: No architectural violations detected.');

        // ADR 012: 自動承認判定
        if (autoApprove && result.risk_level === 'low') {
          // 人間が CHANGES_REQUESTED レビューを残しているか確認
          const hasHumanChanges = await hasChangesRequestedFromHumans(githubToken, prNumber);
          if (hasHumanChanges) {
            core.info('Skipping auto-approve due to human CHANGES_REQUESTED');
          } else {
            // 未解決の会話スレッドが残っているか確認（業界標準）
            const hasUnresolved = await hasUnresolvedComments(githubToken, prNumber);
            if (hasUnresolved) {
              core.info('Skipping auto-approve due to unresolved conversations');
            } else {
              await submitAutoApproveReview(githubToken, prNumber);
              core.info(`[Auto-Approve Audit Log] Approved PR #${prNumber} automatically.`);
            }
          }
        }
      } else {
        core.info('❌ ADR Violation detected. Posting comment to PR...');
        
        // ADR-009: リンク等のサニタイズ
        const sanitizedReasoning = sanitizeAiResponse(result.reasoning);
        
        let commentBody = `## 🚨 Architecture Violation Detected\n\n${sanitizedReasoning}`;
        
        // Auto-remediation Suggestion を付与 (ADR 004)
        if (result.suggestion) {
          commentBody += `\n\n### 💡 Auto-remediation Suggestion\n\`\`\`suggestion\n${result.suggestion}\n\`\`\``;
        }

        await postOrUpdateComment(githubToken, prNumber, commentBody);
        
        // CIを失敗させる
        core.setFailed('ADR Violation detected. See PR comment for details.');
      }
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
