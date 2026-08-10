import * as fs from 'fs';
import * as path from 'path';

// ADR-011: ADR ドキュメントの合計サイズ（文字数）に安全な上限値を設定する (Fail-Closed)
const MAX_ADR_SIZE = 100000;

function assertWithinAdrSizeLimit(combinedContent: string): void {
  if (combinedContent.length > MAX_ADR_SIZE) {
    throw new Error('ADR documents size exceeds the maximum limit');
  }
}

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

  combinedContent = combinedContent.trim();
  assertWithinAdrSizeLimit(combinedContent);

  return combinedContent;
}

export interface AdrIndexEntry {
  fileName: string;
  title: string;
  description: string;
}

/**
 * ADR-013: frontmatterの`title`/`description`のみを抽出した軽量インデックスを構築します（Document Summary Index）。
 * Stage 1（関連ADRの絞り込み）のLLM呼び出しに、全文の代わりに渡すために使用します。
 *
 * frontmatterを持たない古い形式のADRファイルにも後方互換的に対応し、
 * 本文の最初の見出し（`# ...`）を title としてフォールバックします。
 */
export function loadAdrIndex(directoryPath: string): AdrIndexEntry[] {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`ADR directory not found: ${directoryPath}`);
  }

  const files = fs.readdirSync(directoryPath);
  const index: AdrIndexEntry[] = [];

  for (const file of files) {
    const fullPath = path.join(directoryPath, file);

    if (fs.statSync(fullPath).isDirectory() || !file.endsWith('.md')) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const { title, description } = parseAdrFrontmatter(content, file);
    index.push({ fileName: file, title, description });
  }

  return index;
}

/**
 * ADR-013 Stage 2: Stage 1で絞り込まれたファイル名のADRのみ、フル本文を結合して返します。
 * `loadAdrFiles` と同じ `MAX_ADR_SIZE` の安全側マージンを、絞り込んだ結果に対しても引き続き適用します。
 * 実在しないファイル名（LLMのハルシネーション等）が含まれていても無視し、クラッシュしません。
 */
export function loadAdrFilesByNames(directoryPath: string, fileNames: string[]): string {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`ADR directory not found: ${directoryPath}`);
  }

  const nameSet = new Set(fileNames);
  const files = fs.readdirSync(directoryPath);
  let combinedContent = '';

  for (const file of files) {
    if (!nameSet.has(file)) {
      continue;
    }

    const fullPath = path.join(directoryPath, file);
    if (fs.statSync(fullPath).isDirectory() || !file.endsWith('.md')) {
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    combinedContent += content + '\n\n';
  }

  combinedContent = combinedContent.trim();
  assertWithinAdrSizeLimit(combinedContent);

  return combinedContent;
}

function parseAdrFrontmatter(content: string, fallbackFileName: string): { title: string; description: string } {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const yamlBlock = frontmatterMatch?.[1];
  if (yamlBlock) {
    const title = extractYamlField(yamlBlock, 'title');
    const description = extractYamlField(yamlBlock, 'description');
    if (title || description) {
      return { title: title || fallbackFileName, description };
    }
  }

  // frontmatterが無い、またはtitle/descriptionが取得できない古い形式のADRは、
  // 本文の最初の見出しをtitleとしてフォールバックする
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const heading = headingMatch?.[1];
  return {
    title: heading ? heading.trim() : fallbackFileName,
    description: '',
  };
}

function extractYamlField(yamlBlock: string, field: string): string {
  const regex = new RegExp(`^${field}:\\s*"?([^"\\n]*)"?\\s*$`, 'm');
  const value = yamlBlock.match(regex)?.[1];
  return value ? value.trim() : '';
}
