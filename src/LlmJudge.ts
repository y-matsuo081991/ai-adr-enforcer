import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';

// LLMからの出力を検証・パースするためのZodスキーマ
const JudgeResultSchema = z.object({
  decision: z.enum(['pass', 'fail']),
  reasoning: z.string(),
  suggestion: z.string().optional(),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;

export class LlmJudge {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    // 新しいSDKの初期化
    this.ai = new GoogleGenAI({ apiKey });
  }

  async evaluate(adrContent: string, prDiff: string): Promise<JudgeResult> {
    const prompt = `
You are an expert Software Architect and Code Reviewer.
Your task is to audit the provided Pull Request Diff against the given Architecture Decision Records (ADRs).

[ADR]
${adrContent}

[PR Diff]
${prDiff}

Please determine if the PR Diff violates any rules or constraints defined in the ADR.
Return your decision as "pass" or "fail", along with your reasoning.
If the decision is "fail", you MUST provide a "suggestion" containing the corrected code snippet that resolves the violation. The suggestion should be ready to be used in a GitHub Review Comment suggestion block (do not include the markdown backticks \`\`\`suggestion itself, just the code).
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
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseSchema,
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
        // セキュリティ制約 (GEMINI.md): LLMの推論結果には機密情報が含まれる可能性があるため、
        // 生のテキストやレスポンス内容は絶対にログに出力しないこと。
        throw parseError;
      }
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(`Failed to validate LLM response schema: ${error.message}`);
      }
      throw error;
    }
  }
}
