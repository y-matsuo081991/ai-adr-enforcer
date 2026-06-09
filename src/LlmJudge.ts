import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';

// LLMからの出力を検証・パースするためのZodスキーマ
const JudgeResultSchema = z.object({
  decision: z.enum(['pass', 'fail']),
  reasoning: z.string(),
  suggestion: z.string().nullable().optional(),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export class LlmJudge {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    // 新しいSDKの初期化
    this.ai = new GoogleGenAI({ apiKey });
  }

  async evaluate(adrContent: string, prDiff: string): Promise<JudgeResult> {
    const systemPrompt = `
You are an expert Software Architect and Code Reviewer.
Your task is to audit the provided Pull Request Diff against the given Architecture Decision Records (ADRs).

<adr_documents>
${adrContent}
</adr_documents>

Please determine if the PR Diff violates any rules or constraints defined in the <adr_documents>.
Return your decision as "pass" or "fail", along with your reasoning.
If the decision is "fail", you MUST provide a "suggestion" containing the corrected code snippet that resolves the violation. The suggestion should be ready to be used in a GitHub Review Comment suggestion block (do not include the markdown backticks \`\`\`suggestion itself, just the code).
`;

    const userMessage = `
Please audit the following Pull Request Diff:

<pull_request_diff>
${prDiff}
</pull_request_diff>
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
        suggestion: {
          type: Type.STRING,
          description: 'If fail, provide the corrected code snippet. Omit if pass.',
          nullable: true,
        },
      },
      required: ['decision', 'reasoning'],
    };

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: userMessage,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
          httpOptions: { timeout: 30000 }, // 30秒のタイムアウト（デッドロック防止）
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
