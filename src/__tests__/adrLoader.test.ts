import * as fs from 'fs';
import * as path from 'path';
import { loadAdrFiles } from '../utils/adrLoader';

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
