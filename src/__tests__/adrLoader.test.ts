import * as fs from 'fs';
import * as path from 'path';
import { loadAdrFiles, loadAdrIndex, loadAdrFilesByNames } from '../utils/adrLoader';

jest.mock('fs');

describe('adrLoader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. 指定されたディレクトリ内の .md ファイルをすべて読み込み、結合して返すこと', () => {
    // Arrange: fsモックの設定（ダミーのディレクトリとファイル構成）
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-test.md', '002-rules.md', 'not-markdown.txt']);
    
    // .md ファイルのみが読まれる想定
    (fs.statSync as jest.Mock).mockImplementation((filePath: string) => {
      return { isDirectory: () => false };
    });
    
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string, encoding: string) => {
      if (filePath.includes('001-test.md')) return '# ADR 001\nTest content 1';
      if (filePath.includes('002-rules.md')) return '# ADR 002\nTest content 2';
      return '';
    });

    // Act
    const result = loadAdrFiles(dummyDir);

    // Assert
    expect(fs.readFileSync).toHaveBeenCalledTimes(2); // .txt はスキップされること
    expect(result).toContain('# ADR 001');
    expect(result).toContain('# ADR 002');
  });

  it('2. ディレクトリが存在しない場合はエラーをスローすること', () => {
    // Arrange
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    // Act & Assert
    expect(() => loadAdrFiles('invalid/path')).toThrow('ADR directory not found');
  });

  it('3. [ADR-011] 取得したADRドキュメントの合計サイズが制限(デフォルト100,000文字)を超過した場合、エラーをスローすること', () => {
    // Arrange
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-large.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    
    // 制限を超える大きな文字列を返す
    const largeContent = 'a'.repeat(100001);
    (fs.readFileSync as jest.Mock).mockReturnValue(largeContent);

    // Act & Assert
    expect(() => loadAdrFiles(dummyDir)).toThrow('ADR documents size exceeds the maximum limit');
  });
});

describe('loadAdrIndex [ADR-013] 軽量インデックス（Stage 1用）の抽出', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. frontmatterを持つADRファイルから { fileName, title, description } を抽出すること', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['012-hybrid-auto-approve-policy.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    (fs.readFileSync as jest.Mock).mockReturnValue(
      '---\ntitle: "ADR 012: ハイブリッド自動承認"\ndescription: "AIと静的ルールを組み合わせた自動承認の定義"\nstatus: "Accepted"\ndate: "2026-06-13"\n---\n\n# ADR 012: ハイブリッド自動承認\n\n本文...',
    );

    const result = loadAdrIndex(dummyDir);

    expect(result).toEqual([
      {
        fileName: '012-hybrid-auto-approve-policy.md',
        title: 'ADR 012: ハイブリッド自動承認',
        description: 'AIと静的ルールを組み合わせた自動承認の定義',
      },
    ]);
  });

  it('2. frontmatterを持たない古い形式のADRファイルでも、本文の見出しをtitleとしてフォールバックし、エラーにならないこと', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['011-legacy-no-frontmatter.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    (fs.readFileSync as jest.Mock).mockReturnValue(
      '# ADR 011: プロンプトインジェクション耐性の強化\n\n## Status\nProposed\n',
    );

    const result = loadAdrIndex(dummyDir);

    expect(result).toEqual([
      {
        fileName: '011-legacy-no-frontmatter.md',
        title: 'ADR 011: プロンプトインジェクション耐性の強化',
        description: '',
      },
    ]);
  });

  it('3. .md以外のファイルやディレクトリはインデックスに含めないこと', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-test.md', 'not-markdown.txt', 'subdir']);
    (fs.statSync as jest.Mock).mockImplementation((filePath: string) => ({
      isDirectory: () => filePath.includes('subdir'),
    }));
    (fs.readFileSync as jest.Mock).mockReturnValue('---\ntitle: "T"\ndescription: "D"\n---\n# T\n');

    const result = loadAdrIndex(dummyDir);

    expect(result).toHaveLength(1);
    expect(result[0]?.fileName).toBe('001-test.md');
  });

  it('4. ディレクトリが存在しない場合はエラーをスローすること', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    expect(() => loadAdrIndex('invalid/path')).toThrow('ADR directory not found');
  });
});

describe('loadAdrFilesByNames [ADR-013] Stage 2: 絞り込んだADRのみの本文読み込み', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. 指定したファイル名のADRのみを結合して返し、指定外のファイルは無視すること', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-test.md', '002-rules.md', '003-unrelated.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.includes('001-test.md')) return '# ADR 001\nContent 1';
      if (filePath.includes('002-rules.md')) return '# ADR 002\nContent 2';
      if (filePath.includes('003-unrelated.md')) return '# ADR 003\nContent 3';
      return '';
    });

    const result = loadAdrFilesByNames(dummyDir, ['001-test.md', '002-rules.md']);

    expect(result).toContain('# ADR 001');
    expect(result).toContain('# ADR 002');
    expect(result).not.toContain('# ADR 003');
    expect(fs.readFileSync).toHaveBeenCalledTimes(2);
  });

  it('2. 空配列を渡した場合は空文字列を返し、ファイルを一切読み込まないこと', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-test.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));

    const result = loadAdrFilesByNames(dummyDir, []);

    expect(result).toBe('');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('3. [ADR-011の安全側マージンを維持] 絞り込んだ後の合計サイズが上限を超える場合、エラーをスローすること', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-large.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    (fs.readFileSync as jest.Mock).mockReturnValue('a'.repeat(100001));

    expect(() => loadAdrFilesByNames(dummyDir, ['001-large.md'])).toThrow(
      'ADR documents size exceeds the maximum limit',
    );
  });

  it('4. 実在しないファイル名が渡されても無視してクラッシュしないこと（Stage 1のハルシネーション対策の多層防御）', () => {
    const dummyDir = 'dummy/docs/adr';
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readdirSync as jest.Mock).mockReturnValue(['001-test.md']);
    (fs.statSync as jest.Mock).mockImplementation(() => ({ isDirectory: () => false }));
    (fs.readFileSync as jest.Mock).mockReturnValue('# ADR 001\nContent 1');

    const result = loadAdrFilesByNames(dummyDir, ['999-does-not-exist.md', '001-test.md']);

    expect(result).toBe('# ADR 001\nContent 1');
  });
});
