import { AdrRouter } from '../utils/adrRouter';
import { AdrIndexEntry } from '../utils/adrLoader';

// @google/genai モジュールをモックし、外部APIを叩かずにテストを完結させる
const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => {
  return {
    Type: { OBJECT: 'OBJECT', STRING: 'STRING', ARRAY: 'ARRAY' },
    GoogleGenAI: jest.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

describe('AdrRouter [ADR-013] Stage 1: 軽量インデックスによる関連ADR絞り込み', () => {
  let router: AdrRouter;

  const dummyIndex: AdrIndexEntry[] = [
    { fileName: '001-db.md', title: 'ADR 001: データベース選定', description: 'SQLiteを使うこと' },
    { fileName: '002-styling.md', title: 'ADR 002: スタイリング規約', description: 'Tailwindを使うこと' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    router = new AdrRouter('dummy_api_key');
  });

  it('1. LLMが関連ありと判定したファイル名の配列を返すこと', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: ['001-db.md'] }),
    });

    const result = await router.selectRelevantAdrs(dummyIndex, '+ import mysql from "mysql2";');

    expect(result).toEqual(['001-db.md']);
  });

  it('2. インデックスが空配列の場合、LLMを呼び出さずに空配列を返すこと', async () => {
    const result = await router.selectRelevantAdrs([], '+ const a = 1;');

    expect(result).toEqual([]);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('3. リクエストにフル本文ではなく、title/descriptionだけの軽量インデックスが渡されていること', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: [] }),
    });

    await router.selectRelevantAdrs(dummyIndex, '+ const a = 1;');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          systemInstruction: expect.stringContaining('SQLiteを使うこと'),
        }),
      }),
    );
  });

  it('4. [ハルシネーション対策] responseSchemaが、実在するファイル名のみを許容するenumで制約されていること', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: [] }),
    });

    await router.selectRelevantAdrs(dummyIndex, '+ const a = 1;');

    const callArgs = mockGenerateContent.mock.calls[0]?.[0];
    const enumValues = callArgs?.config?.responseSchema?.properties?.selected_file_names?.items?.enum;

    expect(enumValues).toEqual(['001-db.md', '002-styling.md']);
  });

  it('5. LLMが実在しないファイル名を返した場合、スキーマ検証エラーとしてスローすること（ハルシネーション対策）', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: ['999-does-not-exist.md'] }),
    });

    await expect(router.selectRelevantAdrs(dummyIndex, '+ const a = 1;')).rejects.toThrow(
      'AdrRouter: Failed to validate LLM response schema. The response format was invalid.',
    );
  });

  it('6. LLMが空のレスポンスを返した場合、エラーをスローすること', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });

    await expect(router.selectRelevantAdrs(dummyIndex, '+ const a = 1;')).rejects.toThrow(
      'AdrRouter: LLM returned an empty response.',
    );
  });

  it('7. マークダウンのコードブロック記法（```json）付きでレスポンスが返っても正しくパースできること', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '```json\n{"selected_file_names": ["002-styling.md"]}\n```',
    });

    const result = await router.selectRelevantAdrs(dummyIndex, '+ const a = 1;');

    expect(result).toEqual(['002-styling.md']);
  });

  it('8. [LlmJudgeとの一貫性] コンストラクタでモデル名を省略した場合、デフォルトの gemini-3.1-flash-lite が使われること', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: [] }),
    });

    await router.selectRelevantAdrs(dummyIndex, '+ const a = 1;');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-flash-lite' }),
    );
  });

  it('9. [LlmJudgeとの一貫性] コンストラクタで指定された任意のモデル名でAPIが呼び出されること', async () => {
    const customRouter = new AdrRouter('dummy_api_key', 'gemini-3.5-flash');
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selected_file_names: [] }),
    });

    await customRouter.selectRelevantAdrs(dummyIndex, '+ const a = 1;');

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.5-flash' }),
    );
  });
});
