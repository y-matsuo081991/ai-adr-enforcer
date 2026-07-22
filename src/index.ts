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
  hasUnresolvedComments,
  getHumanGeneralComments
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

/**
 * 変更ファイルがすべて安全なファイル（静的資産・設定ファイル等）であるか判定します。
 * 
 * @param files 変更されたファイルのリスト
 * @returns すべて安全なファイルであれば true、それ以外は false
 */
function isSafeFilesOnly(files: string[]): boolean {
  if (files.length === 0) return false;
  
  // 安全なファイルの拡張子やパターン
  const safePatterns = [
    /\.md$/i,
    /package\.json$/i,
    /tsconfig\.json$/i,
    /\.ya?ml$/i,
    /\.gitignore$/i,
    /LICENSE$/i
  ];

  return files.every(file => 
    safePatterns.some(pattern => pattern.test(file))
  );
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
    const model = core.getInput('model') || 'gemini-3.1-flash-lite';

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
    
    // ADR-012: 安全ファイルのみの変更判定
    let isSafeFiles = false;
    let changedFiles: string[] = [];
    try {
      changedFiles = await getPrChangedFilesList(githubToken, prNumber);
      isSafeFiles = isSafeFilesOnly(changedFiles);
    } catch (e) {
      core.warning(`Failed to fetch changed files list: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    core.info(`PR change stats: ${changedLines} lines of code modified. Safe files only: ${isSafeFiles}`);

    const judge = new LlmJudge(geminiApiKey, model);

    // 静的ルールによる足切り判定（オプトアウト）
    // 安全なファイルのみの変更、または変更規模が30行以下の場合は通常監査（＝自動承認可能）
    const isStaticRulePass = isSafeFiles || (changedLines <= autoApproveMaxLines);

    // 4. LlmJudge による監査フェーズ (分岐判定)
    if (autoApprove && !isStaticRulePass) {
      // 巨大PR向け：一括監査に変更 (N+1問題の解決)
      core.info('Executing single-request consolidated audit for large PR');
      
      const prAuthor = context.payload.pull_request?.user?.login || '';
      const humanComments = await getHumanGeneralComments(githubToken, prNumber, prAuthor);
      const result = await judge.evaluate(adrContent, prDiff, humanComments);

      // 監査メタデータログを出力
      const auditLog = `[Auto-Approve Audit Log]
- Enabled: ${autoApprove}
- Is Safe Files Only: ${isSafeFiles}
- Total Diff Lines: ${changedLines} (Threshold: ${autoApproveMaxLines}) -> SKIP
- AI Decision: ${result.decision}
- AI Risk Level: ${result.risk_level || 'low'}
- Result: Skipped (Change scale exceeds threshold)`;
      core.info(auditLog);

      if (result.decision === 'fail') {
        core.info('❌ ADR Violation detected on large PR. Posting comment...');
        let commentBody = `## 🚨 Architecture Violation Detected (Large PR Audit)\n\n${result.reasoning}`;
        if (result.suggestion) {
          commentBody += `\n\n### 💡 Auto-remediation Suggestion\n\`\`\`suggestion\n${result.suggestion}\n\`\`\``;
        }
        await postOrUpdateComment(githubToken, prNumber, commentBody);
        core.setFailed('ADR Violation detected. See PR comment for details.');
      } else {
        core.info('✅ ADR Check Passed: No architectural violations detected in consolidated large PR audit.');
      }
    } else {
      // 通常規模PRの通常監査、あるいは自動承認が無効な場合の既存フロー
      core.info('Data fetching completed. Proceeding to evaluation...');
      
      const prAuthor = context.payload.pull_request?.user?.login || '';
      const humanComments = await getHumanGeneralComments(githubToken, prNumber, prAuthor);
      const result = await judge.evaluate(adrContent, prDiff, humanComments);

      // 5. フィードバックフェーズ
      if (result.decision === 'pass') {
        core.info('✅ ADR Check Passed: No architectural violations detected.');

        // ADR 012: 自動承認判定
        if (autoApprove) {
          const hasHumanChanges = await hasChangesRequestedFromHumans(githubToken, prNumber);
          const hasUnresolvedThreads = await hasUnresolvedComments(githubToken, prNumber);
          const isRiskLevelLow = result.risk_level === 'low';
          const isRemediationPass = result.remediation_status !== 'unresolved';

          let auditResult = '';
          if (!isRiskLevelLow) {
            auditResult = `Skipped (Risk Level: ${result.risk_level || 'unknown'})`;
          } else if (hasHumanChanges) {
            auditResult = 'Skipped (Human CHANGES_REQUESTED exists)';
          } else if (hasUnresolvedThreads) {
            auditResult = 'Skipped (Unresolved physical comment threads exist)';
          } else if (!isRemediationPass) {
            auditResult = 'Skipped (Unresolved human comments evaluated by AI)';
          } else {
            auditResult = 'Approved (Review submitted)';
          }

          // 監査ログ（Audit Trail）の構築と出力
          const auditLog = `[Auto-Approve Audit Log]
- Enabled: ${autoApprove}
- Is Safe Files Only: ${isSafeFiles}
- Total Diff Lines: ${changedLines} (Threshold: ${autoApproveMaxLines}) -> PASS
- AI Decision: ${result.decision}
- AI Risk Level: ${result.risk_level || 'low'} -> ${isRiskLevelLow ? 'PASS' : 'SKIP'}
- Result: ${auditResult}`;

          core.info(auditLog);

          if (isRiskLevelLow) {
            if (hasHumanChanges) {
              core.info('Skipping auto-approve due to human CHANGES_REQUESTED');
            } else if (hasUnresolvedThreads) {
              core.info('Skipping auto-approve due to unresolved physical comment threads');
            } else if (!isRemediationPass) {
              core.info('Skipping auto-approve due to unresolved human comments evaluated by AI');
              
              if (result.remediation_advice) {
                const adviceComment = `### ⚠️ Previous Human Review Unresolved\n\nSome of the previous human review comments are still outstanding or not fully addressed in the latest changes.\n\n#### 💡 Remediation Advice:\n${result.remediation_advice}`;
                await postOrUpdateComment(githubToken, prNumber, adviceComment);
              }
            } else {
              // 過去指摘が解決済み (resolved) または そもそも存在しない (no_human_comments) の場合
              await submitAutoApproveReview(githubToken, prNumber);
              core.info(`[Auto-Approve Audit Log] Approved PR #${prNumber} automatically.`);
            }
          } else {
            core.info(`Skipping auto-approve due to risk level: ${result.risk_level || 'unknown'}`);
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
