import * as fs from 'fs';
import * as path from 'path';

/**
 * 指定されたディレクトリ内のすべての Markdown (.md) ファイルを読み込み、
 * 1つの文字列として結合して返します。
 * 
 * @param directoryPath ADRファイルが格納されているディレクトリのパス
 * @returns 結合されたMarkdownテキスト
 */
export function loadAdrFiles(directoryPath: string): string {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`ADR directory not found: ${directoryPath}`);
  }

  const files = fs.readdirSync(directoryPath);
  let combinedContent = '';

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);
    
    // ディレクトリや .md 以外のファイルはスキップ
    if (fs.statSync(fullPath).isDirectory() || !file.endsWith('.md')) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    combinedContent += content + '\n\n';
  }

  return combinedContent.trim();
}
