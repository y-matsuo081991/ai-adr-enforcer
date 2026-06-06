import { LlmJudge } from '../LlmJudge';
import { z } from 'zod';

// @google/genai モジュールをモックし、外部APIを叩かずにテストを完結させる
jest.mock('@google/genai', () => {
  return {
    Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
    GoogleGenAI: jest.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: jest.fn().mockImplementation(async (params) => {
            const contents = params.contents;
            // エラー誘発用の特殊な入力
            if (contents.includes('MAKE_IT_INVALID_JSON')) {
              return { text: '{"decision": "pass", "reasoning": 123}' }; // reasoningが文字列でないためZodエラー
            }
            
            // Diffの中に 'sqlite3' という文字列が含まれていればPassとして返す（ダミーロジック）
            if (contents.includes('sqlite3')) {
              return { text: JSON.stringify({ decision: 'pass', reasoning: 'SQLite is correctly used.' }) };
            } else {
              return { text: JSON.stringify({ decision: 'fail', reasoning: 'MySQL usage violates the ADR constraint.', suggestion: "import sqlite3 from 'sqlite3';\nconst db = new sqlite3.Database(':memory:');" }) };
            }
          }),
        },
      };
    }),
  };
});

describe('LlmJudge (LLM-as-a-Judge Core Engine)', () => {
  let judge: LlmJudge;

  beforeEach(() => {
    jest.clearAllMocks();
    // テスト時はダミーのAPIキーを使用（モックされるため実際には通信しない）
    judge = new LlmJudge('dummy_api_key');
  });

  it('1. ADRの制約を遵守しているDiffに対しては、"pass" の結果を返すこと', async () => {
    // Arrange: GEMINI.md Rule 2 に従いダミーのADRとDiffを使用
    const dummyAdr = `
      # ADR 001: データベース選定
      データベースには必ず SQLite を使用すること。MySQL等の他のDBは禁止。
    `;
    const dummyDiff = `
      + import sqlite3 from 'sqlite3';
      + const db = new sqlite3.Database(':memory:');
    `;

    // Act
    const result = await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    expect(result.decision).toBe('pass');
    expect(result.reasoning).toBeDefined();
    // passの場合はsuggestionはなくてもよい（undefinedまたはnull）
  });

  it('2. ADRの制約に違反しているDiffに対しては、"fail" の結果を返すこと', async () => {
    // Arrange
    const dummyAdr = `
      # ADR 001: データベース選定
      データベースには必ず SQLite を使用すること。MySQL等の他のDBは禁止。
    `;
    const violationDiff = `
      + import mysql from 'mysql2';
      + const connection = mysql.createConnection({host: 'localhost'});
    `;

    // Act
    const result = await judge.evaluate(dummyAdr, violationDiff);

    // Assert
    expect(result.decision).toBe('fail');
    expect(result.reasoning).toContain('MySQL'); // 理由に違反内容が含まれていること
  });

  it('3. [ADR-008] LLMへのリクエストにおいて、System Instruction と User Message が分離されていること', async () => {
    // Arrange
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const a = 1;';

    // Act
    await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    // LlmJudgeの内部で生成されたGoogleGenAIインスタンスのgenerateContentが呼ばれた際の引数を検証
    const mockGenerateContent = (judge as any).ai.models.generateContent;
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro-preview',
        contents: expect.stringContaining(dummyDiff), // contentsにはUser Message (Diff)が入る
        config: expect.objectContaining({
          systemInstruction: expect.stringContaining(dummyAdr), // config.systemInstruction にADRが入る
        })
      })
    );
  });

  it('4. Failと判定した場合、GitHubのSuggestionに使える修正コード案(suggestion)が含まれていること', async () => {
    // Arrange
    const dummyAdr = `
      # ADR 001: データベース選定
      データベースには必ず SQLite を使用すること。MySQL等の他のDBは禁止。
    `;
    const violationDiff = `
      + import mysql from 'mysql2';
      + const connection = mysql.createConnection({host: 'localhost'});
    `;

    // Act
    const result = await judge.evaluate(dummyAdr, violationDiff);

    // Assert
    expect(result.decision).toBe('fail');
    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('sqlite3'); // 修正案にSQLiteを使うコードが含まれていること
  });

  it('5. [ADR-007] ZodErrorが発生した場合、機密情報を含む生のエラーメッセージはマスクされ、定型文がスローされること', async () => {
    // Arrange
    const dummyAdr = 'ADR 001: DB contains secret user data';
    const invalidDiff = 'MAKE_IT_INVALID_JSON'; // モックが不正なJSONを返すように仕向ける

    // Act & Assert
    // ZodErrorが投げられた際、生の値が含まれていない静的メッセージであることを確認する
    await expect(judge.evaluate(dummyAdr, invalidDiff)).rejects.toThrow('Failed to validate LLM response schema. The response format was invalid.');
  });
});
