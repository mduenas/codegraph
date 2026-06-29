/**
 * Grammar Loading and Caching
 *
 * Manages tree-sitter language grammars via WASM (web-tree-sitter).
 */

import * as path from 'path';
import { Parser, Language as WasmLanguage } from 'web-tree-sitter';
import { Language } from '../types';

function getWasmDir(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkgJson = require.resolve('tree-sitter-wasms/package.json');
  return path.join(path.dirname(pkgJson), 'out');
}

/**
 * Map of Language to WASM grammar filename
 */
const GRAMMAR_WASM_FILES: Partial<Record<Language, string>> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  php: 'tree-sitter-php.wasm',
  ruby: 'tree-sitter-ruby.wasm',
  swift: 'tree-sitter-swift.wasm',
  kotlin: 'tree-sitter-kotlin.wasm',
};

/**
 * File extension to Language mapping
 */
export const EXTENSION_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.liquid': 'liquid',
};

/** Loaded WasmLanguage instances, keyed by language */
const languageCache = new Map<Language, WasmLanguage>();

/** Parser instances, keyed by language */
const parserCache = new Map<Language, Parser>();

/** Whether Parser.init() has been called */
let initialized = false;

/**
 * Initialize the WASM runtime. Must be called once before any parsing.
 * Safe to call multiple times (idempotent).
 */
export async function initGrammars(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

/**
 * Load grammars for the given languages (sequentially — parallel loading
 * triggers a race condition in Node.js 20+).
 */
export async function loadGrammarsForLanguages(languages: Language[]): Promise<void> {
  const wasmDir = getWasmDir();
  const toLoad = [...new Set(languages)].filter(
    (lang) => !languageCache.has(lang) && lang in GRAMMAR_WASM_FILES
  );
  for (const lang of toLoad) {
    const wasmFile = GRAMMAR_WASM_FILES[lang]!;
    const wasmPath = path.join(wasmDir, wasmFile);
    const grammar = await WasmLanguage.load(wasmPath);
    languageCache.set(lang, grammar);
  }
}

/**
 * Load all supported grammars. Convenience wrapper for non-incremental use.
 */
export async function loadAllGrammars(): Promise<void> {
  await loadGrammarsForLanguages(Object.keys(GRAMMAR_WASM_FILES) as Language[]);
}

/**
 * Get a parser for the specified language. Returns null if the language
 * grammar has not been loaded yet (call initGrammars + loadGrammarsForLanguages first).
 */
export function getParser(language: Language): Parser | null {
  if (parserCache.has(language)) {
    return parserCache.get(language)!;
  }
  const grammar = languageCache.get(language);
  if (!grammar) return null;
  const parser = new Parser();
  parser.setLanguage(grammar);
  parserCache.set(language, parser);
  return parser;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): Language {
  const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
  return EXTENSION_MAP[ext] || 'unknown';
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(language: Language): boolean {
  if (language === 'liquid') return true;
  return language !== 'unknown' && language in GRAMMAR_WASM_FILES;
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): Language[] {
  const languages = Object.keys(GRAMMAR_WASM_FILES) as Language[];
  languages.push('liquid');
  return languages;
}

/**
 * Clear the parser cache, releasing WASM memory.
 */
export function clearParserCache(): void {
  for (const parser of parserCache.values()) {
    parser.delete();
  }
  parserCache.clear();
}

/**
 * Get language display name
 */
export function getLanguageDisplayName(language: Language): string {
  const names: Record<Language, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    tsx: 'TypeScript (TSX)',
    jsx: 'JavaScript (JSX)',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    java: 'Java',
    c: 'C',
    cpp: 'C++',
    csharp: 'C#',
    php: 'PHP',
    ruby: 'Ruby',
    swift: 'Swift',
    kotlin: 'Kotlin',
    liquid: 'Liquid',
    unknown: 'Unknown',
  };
  return names[language] || language;
}
