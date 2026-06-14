import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';
import * as crypto from 'crypto';

// LLMからの出力を検証・パースするためのZodスキーマ
const JudgeResultSchema = z.object({
  decision: z.enum(['pass', 'fail']),
  reasoning: z.string(),
  risk_level: z.enum(['low', 'medium', 'high']).optional(),
  suggestion: z.string().nullable().optional(),
  remediation_status: z.enum(['resolved', 'unresolved', 'no_human_comments']).optional(),
  remediation_advice: z.string().nullable().optional(),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export class LlmJudge {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    // 新しいSDKの初期化
    this.ai = new GoogleGenAI({ apiKey });
  }

  async evaluate(adrContent: string, prDiff: string, humanComments: string[] = []): Promise<JudgeResult> {
    // ADR-011: 動的サニタイズ（インジェクション対策バリデーション）
    if (prDiff.includes('---BEGIN_DIFF_')) {
      throw new Error('Potential Prompt Injection detected: Diff contains reserved delimiter pattern.');
    }

    // ADR-011: Randomized Delimiters（ランダム化された区切り文字）
    const delimiterId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
    const beginDelimiter = `---BEGIN_DIFF_${delimiterId}---`;
    const endDelimiter = `---END_DIFF_${delimiterId}---`;

    let systemPrompt = `
You are an expert Software Architect and Code Reviewer.
Your task is to audit the provided Pull Request Diff against the given Architecture Decision Records (ADRs).

<adr_documents>
${adrContent}
</adr_documents>

Please determine if the PR Diff violates any rules or constraints defined in the <adr_documents>.
Return your decision as "pass" or "fail", along with your reasoning.
If the decision is "fail", you MUST provide a "suggestion" containing the corrected code snippet that resolves the violation. The suggestion should be ready to be used in a GitHub Review Comment suggestion block (do not include the markdown backticks \`\`\`suggestion itself, just the code).
`;

    if (humanComments.length > 0) {
      systemPrompt += `

Additionally, human reviewers have previously left the following feedback or requested changes in the PR's main comments timeline:
<human_comments_from_previous_revisions>
${humanComments.map((comment, index) => `Comment #${index + 1}: ${comment}`).join('\n---\n')}
</human_comments_from_previous_revisions>

You MUST evaluate whether the new PR Diff has successfully resolved/addressed ALL of these previous human review comments.
Set "remediation_status" to "resolved" if all human comments are fully fixed/addressed by this new diff.
Set "remediation_status" to "unresolved" if any of the human comments are still unfixed or only partially addressed in the new diff.
If "remediation_status" is "unresolved", you MUST provide "remediation_advice" explaining specifically which parts of the previous human review comments are still unaddressed and what the developer needs to do to resolve them.
`;
    } else {
      systemPrompt += `
If there are no human comments provided, set "remediation_status" to "no_human_comments" and "remediation_advice" to null.
`;
    }

    const userMessage = `
Please audit the following Pull Request Diff:

${beginDelimiter}
${prDiff}
${endDelimiter}
`;

    // Gemini APIに要求するJSONのスキーマ定義（Structured Output）
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        decision: {
          type: Type.STRING,
          description: 'The decision, either "pass" or "fail".',
        },
        reasoning: {
          type: Type.STRING,
          description: 'The reasoning behind the decision, citing specific parts of the ADR and Diff.',
        },
        risk_level: {
          type: Type.STRING,
          description: 'The risk level of the changes, either "low", "medium", or "high". Use "low" for highly safe, simple, or low-impact changes.',
          enum: ['low', 'medium', 'high'],
        },
        suggestion: {
          type: Type.STRING,
          description: 'If fail, provide the corrected code snippet. Omit if pass.',
          nullable: true,
        },
        remediation_status: {
          type: Type.STRING,
          description: 'Evaluation of previous human comments resolution. Use "resolved" if all comments are addressed, "unresolved" if any are still outstanding, or "no_human_comments" if none were provided.',
          enum: ['resolved', 'unresolved', 'no_human_comments'],
        },
        remediation_advice: {
          type: Type.STRING,
          description: 'If remediation_status is "unresolved", explain what remains unaddressed and provide remediation advice. Omit or set to null if resolved.',
          nullable: true,
        },
      },
      required: ['decision', 'reasoning', 'risk_level', 'remediation_status'],
    };

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          httpOptions: { timeout: 600000 }, // 600秒のタイムアウト（デッドロック防止）
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('LLM returned an empty response.');
      }

      // 【Defensive Parsing】 LLMがJSONブロックのマークダウン記法(```json ... ```)を返してきた場合を除去する
      const cleanText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

      try {
        const rawJson = JSON.parse(cleanText);
        return JudgeResultSchema.parse(rawJson);
      } catch (parseError) {
        if (parseError instanceof z.ZodError) {
           // ADR-007: セキュリティ保護のため、Zodの生メッセージ（機密情報漏洩リスク）をマスクする
           throw new Error('Failed to validate LLM response schema. The response format was invalid.');
        }
        throw parseError;
      }
      
    } catch (error) {
      // 呼び出し元の catch へそのまま伝播
      throw error;
    }
  }
}
