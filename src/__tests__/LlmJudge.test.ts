import { LlmJudge } from '../LlmJudge';

// @google/genai モジュールをモックし、外部APIを叩かずにテストを完結させる
jest.mock('@google/genai', () => {
  return {
    Type: { OBJECT: 'OBJECT', STRING: 'STRING' },
    GoogleGenAI: jest.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: jest.fn().mockImplementation(async (params) => {
            const contents = params.contents;
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

  it('3. 指定されたモデル（gemini-3.1-pro-preview）でGemini APIが呼び出されること', async () => {
    // Arrange
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const a = 1;';

    // Act
    await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    // LlmJudgeの内部で生成されたGoogleGenAIインスタンスのgenerateContentが呼ばれた際の引数を検証
    // TypeScriptのprivateプロパティにアクセスするためanyキャストを使用
    const mockGenerateContent = (judge as any).ai.models.generateContent;
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro-preview',
      })
    );
  });
});
