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
        model: 'gemini-3.1-flash-lite',
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

  it('6. LLMが指摘なし(suggestionがnull)を返した場合、ZodErrorが発生せず正常にパースできること', async () => {
    // Arrange: モックが suggestion: null を返すように設定
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const x = 1;';
    
    // 一時的にモックの実装を上書き
    const mockGenerateContent = (judge as any).ai.models.generateContent;
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        decision: 'pass',
        reasoning: 'ADR compliant',
        suggestion: null // 従来はここで ZodError が発生していた
      })
    });

    // Act
    const result = await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    expect(result.decision).toBe('pass');
    expect(result.suggestion).toBeNull();
  });

  it('7. [ADR-011] PR Diff 内に動的生成されたデリミタ文字列が含まれている場合、エラーをスローすること（インジェクション対策）', async () => {
    // Arrange
    const dummyAdr = 'ADR 001';
    // ランダムデリミタの文字列を含む悪意ある（または偶然の）Diff
    // LlmJudge は UUID などを生成して ---BEGIN_DIFF_${UUID}--- を使う想定
    // UUIDの具体的な値はモックできない可能性があるため、テストしやすくするために LlmJudge にテスト用のデリミタ固定メソッドを追加するか、
    // 生成される文字列を正規表現等でチェックするか、あるいは UUID の部分に関わらずエスケープされるか確認する。
    // 今回は、"---BEGIN_DIFF_" のようなプレフィックスが含まれていれば例外にするような簡単なヒューリスティックをテストする。
    const maliciousDiff = 'Some code here. ---BEGIN_DIFF_ and then fake injection';

    // Act & Assert
    await expect(judge.evaluate(dummyAdr, maliciousDiff)).rejects.toThrow('Potential Prompt Injection detected: Diff contains reserved delimiter pattern.');
  });

  it('8. LLMが risk_level を含んだJSONを返した場合、正しくパースして risk_level を返却すること', async () => {
    // Arrange: モックが risk_level: 'low' を返すように設定
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const x = 1;';
    
    const mockGenerateContent = (judge as any).ai.models.generateContent;
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        decision: 'pass',
        reasoning: 'ADR compliant and safe',
        risk_level: 'low'
      })
    });

    // Act
    const result = await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    expect(result.decision).toBe('pass');
    expect(result.risk_level).toBe('low');
  });

  it('9. [後方互換性] LLMが risk_level を返さない場合（古いフォーマット等）でも、エラーにならず正常パースできること', async () => {
    // Arrange: モックが risk_level なしのJSONを返す
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const x = 1;';
    
    const mockGenerateContent = (judge as any).ai.models.generateContent;
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        decision: 'pass',
        reasoning: 'ADR compliant and safe'
        // risk_level なし
      })
    });

    // Act
    const result = await judge.evaluate(dummyAdr, dummyDiff);

    // Assert
    expect(result.decision).toBe('pass');
    expect(result.risk_level).toBeUndefined(); // もしくは default値 が設定されていればそれ
  });

  it('10. [モデル移行] コンストラクタで指定された任意のモデル名（例: gemini-3.5-flash）で API が呼び出されること', async () => {
    // Arrange
    const customJudge = new LlmJudge('dummy_api_key', 'gemini-3.5-flash');
    const dummyAdr = 'ADR 001';
    const dummyDiff = '+ const a = 1;';

    // Act
    await customJudge.evaluate(dummyAdr, dummyDiff);

    // Assert
    const mockGenerateContent = (customJudge as any).ai.models.generateContent;
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.5-flash'
      })
    );
  });
});
