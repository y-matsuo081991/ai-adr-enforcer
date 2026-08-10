import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';
import { AdrIndexEntry } from './adrLoader';
import { GEMINI_MODEL } from './geminiModel';

/**
 * ADR-013 Stage 1: 「軽量なインデックス（title/descriptionのみ）」と「PR Diff」を渡し、
 * このDiffの監査に関連しそうなADRファイル名だけをLLMに絞り込ませる（Document Summary Index パターン）。
 *
 * ハルシネーション対策として、responseSchemaの enum を実在するファイル名のみに動的制約し、
 * それでも実在しないファイル名が返ってきた場合はZodバリデーションで検出してエラーにする。
 */
export class AdrRouter {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async selectRelevantAdrs(index: AdrIndexEntry[], prDiff: string): Promise<string[]> {
    if (index.length === 0) {
      return [];
    }

    const validFileNames = index.map((entry) => entry.fileName);
    const RouterResultSchema = z.object({
      selected_file_names: z.array(z.enum(validFileNames as [string, ...string[]])),
    });

    const indexText = index
      .map((entry) => `- ${entry.fileName}\n  title: ${entry.title}\n  description: ${entry.description}`)
      .join('\n');

    const systemPrompt = `
You are an expert Software Architect. Below is a lightweight index of Architecture Decision Records (ADRs) available in this repository. Each entry only contains a file name, title, and short description (NOT the full ADR content).

<adr_index>
${indexText}
</adr_index>

Given the Pull Request Diff provided by the user, select every ADR file name from the index above that MIGHT be relevant to auditing this diff for architecture violations.

Err on the side of over-inclusion: if you are unsure whether an ADR applies, include it anyway. Only exclude ADRs that are clearly unrelated to the files, technologies, or concerns touched by this diff.
Return only file names that appear verbatim in the index above.
`;

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        selected_file_names: {
          type: Type.ARRAY,
          description: 'File names (from the index) of ADRs that might be relevant to this diff.',
          items: {
            type: Type.STRING,
            enum: validFileNames,
          },
        },
      },
      required: ['selected_file_names'],
    };

    const response = await this.ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prDiff,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        httpOptions: { timeout: 600000 }, // 600秒のタイムアウト（デッドロック防止）
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('AdrRouter: LLM returned an empty response.');
    }

    // 【Defensive Parsing】 LLMがJSONブロックのマークダウン記法(```json ... ```)を返してきた場合を除去する
    const cleanText = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();

    try {
      const rawJson = JSON.parse(cleanText);
      const parsed = RouterResultSchema.parse(rawJson);
      return parsed.selected_file_names;
    } catch (parseError) {
      if (parseError instanceof z.ZodError) {
        // ADR-007: セキュリティ保護のため、Zodの生メッセージ（機密情報漏洩リスク）をマスクする
        throw new Error('AdrRouter: Failed to validate LLM response schema. The response format was invalid.');
      }
      throw parseError;
    }
  }
}
