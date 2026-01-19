/**
 * Tree-sitter Parser Wrapper
 *
 * Handles parsing source code and extracting structural information.
 */

import { SyntaxNode, Tree } from 'tree-sitter';
import * as crypto from 'crypto';
import {
  Language,
  Node,
  Edge,
  NodeKind,
  ExtractionResult,
  ExtractionError,
  UnresolvedReference,
} from '../types';
import { getParser, detectLanguage, isLanguageSupported } from './grammars';

/**
 * Generate a unique node ID
 *
 * Uses a 32-character (128-bit) hash to avoid collisions when indexing
 * large codebases with many files containing similar symbols.
 */
export function generateNodeId(
  filePath: string,
  kind: NodeKind,
  name: string,
  line: number
): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${filePath}:${kind}:${name}:${line}`)
    .digest('hex')
    .substring(0, 32);
  return `${kind}:${hash}`;
}

/**
 * Extract text from a syntax node
 */
function getNodeText(node: SyntaxNode, source: string): string {
  return source.substring(node.startIndex, node.endIndex);
}

/**
 * Find a child node by field name
 */
function getChildByField(node: SyntaxNode, fieldName: string): SyntaxNode | null {
  return node.childForFieldName(fieldName);
}

/**
 * Get the docstring/comment preceding a node
 */
function getPrecedingDocstring(node: SyntaxNode, source: string): string | undefined {
  let sibling = node.previousNamedSibling;
  const comments: string[] = [];

  while (sibling) {
    if (
      sibling.type === 'comment' ||
      sibling.type === 'line_comment' ||
      sibling.type === 'block_comment' ||
      sibling.type === 'documentation_comment'
    ) {
      comments.unshift(getNodeText(sibling, source));
      sibling = sibling.previousNamedSibling;
    } else {
      break;
    }
  }

  if (comments.length === 0) return undefined;

  // Clean up comment markers
  return comments
    .map((c) =>
      c
        .replace(/^\/\*\*?|\*\/$/g, '')
        .replace(/^\/\/\s?/gm, '')
        .replace(/^\s*\*\s?/gm, '')
        .trim()
    )
    .join('\n')
    .trim();
}

/**
 * Language-specific extraction configuration
 */
interface LanguageExtractor {
  /** Node types that represent functions */
  functionTypes: string[];
  /** Node types that represent classes */
  classTypes: string[];
  /** Node types that represent methods */
  methodTypes: string[];
  /** Node types that represent interfaces/protocols/traits */
  interfaceTypes: string[];
  /** Node types that represent structs */
  structTypes: string[];
  /** Node types that represent enums */
  enumTypes: string[];
  /** Node types that represent imports */
  importTypes: string[];
  /** Node types that represent function calls */
  callTypes: string[];
  /** Field name for identifier/name */
  nameField: string;
  /** Field name for body */
  bodyField: string;
  /** Field name for parameters */
  paramsField: string;
  /** Field name for return type */
  returnField?: string;
  /** Extract signature from node */
  getSignature?: (node: SyntaxNode, source: string) => string | undefined;
  /** Extract visibility from node */
  getVisibility?: (node: SyntaxNode) => 'public' | 'private' | 'protected' | 'internal' | undefined;
  /** Check if node is exported */
  isExported?: (node: SyntaxNode, source: string) => boolean;
  /** Check if node is async */
  isAsync?: (node: SyntaxNode) => boolean;
  /** Check if node is static */
  isStatic?: (node: SyntaxNode) => boolean;
}

/**
 * Language-specific extractors
 */
const EXTRACTORS: Partial<Record<Language, LanguageExtractor>> = {
  typescript: {
    functionTypes: ['function_declaration', 'arrow_function', 'function_expression'],
    classTypes: ['class_declaration'],
    methodTypes: ['method_definition', 'public_field_definition'],
    interfaceTypes: ['interface_declaration'],
    structTypes: [],
    enumTypes: ['enum_declaration'],
    importTypes: ['import_statement'],
    callTypes: ['call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'return_type',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      const returnType = getChildByField(node, 'return_type');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (returnType) {
        sig += ': ' + getNodeText(returnType, source).replace(/^:\s*/, '');
      }
      return sig;
    },
    getVisibility: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'accessibility_modifier') {
          const text = child.text;
          if (text === 'public') return 'public';
          if (text === 'private') return 'private';
          if (text === 'protected') return 'protected';
        }
      }
      return undefined;
    },
    isExported: (node, source) => {
      const parent = node.parent;
      if (parent?.type === 'export_statement') return true;
      // Check for 'export' keyword before declaration
      const text = source.substring(Math.max(0, node.startIndex - 10), node.startIndex);
      return text.includes('export');
    },
    isAsync: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'async') return true;
      }
      return false;
    },
    isStatic: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'static') return true;
      }
      return false;
    },
  },
  javascript: {
    functionTypes: ['function_declaration', 'arrow_function', 'function_expression'],
    classTypes: ['class_declaration'],
    methodTypes: ['method_definition', 'field_definition'],
    interfaceTypes: [],
    structTypes: [],
    enumTypes: [],
    importTypes: ['import_statement'],
    callTypes: ['call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      return params ? getNodeText(params, source) : undefined;
    },
    isExported: (node, source) => {
      const parent = node.parent;
      if (parent?.type === 'export_statement') return true;
      const text = source.substring(Math.max(0, node.startIndex - 10), node.startIndex);
      return text.includes('export');
    },
    isAsync: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'async') return true;
      }
      return false;
    },
  },
  python: {
    functionTypes: ['function_definition'],
    classTypes: ['class_definition'],
    methodTypes: ['function_definition'], // Methods are functions inside classes
    interfaceTypes: [],
    structTypes: [],
    enumTypes: [],
    importTypes: ['import_statement', 'import_from_statement'],
    callTypes: ['call'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'return_type',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      const returnType = getChildByField(node, 'return_type');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (returnType) {
        sig += ' -> ' + getNodeText(returnType, source);
      }
      return sig;
    },
    isAsync: (node) => {
      const prev = node.previousSibling;
      return prev?.type === 'async';
    },
    isStatic: (node) => {
      // Check for @staticmethod decorator
      const prev = node.previousNamedSibling;
      if (prev?.type === 'decorator') {
        const text = prev.text;
        return text.includes('staticmethod');
      }
      return false;
    },
  },
  go: {
    functionTypes: ['function_declaration'],
    classTypes: [], // Go doesn't have classes
    methodTypes: ['method_declaration'],
    interfaceTypes: ['interface_type'],
    structTypes: ['struct_type'],
    enumTypes: [],
    importTypes: ['import_declaration'],
    callTypes: ['call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'result',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      const result = getChildByField(node, 'result');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (result) {
        sig += ' ' + getNodeText(result, source);
      }
      return sig;
    },
  },
  rust: {
    functionTypes: ['function_item'],
    classTypes: [], // Rust has impl blocks
    methodTypes: ['function_item'], // Methods are functions in impl blocks
    interfaceTypes: ['trait_item'],
    structTypes: ['struct_item'],
    enumTypes: ['enum_item'],
    importTypes: ['use_declaration'],
    callTypes: ['call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'return_type',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      const returnType = getChildByField(node, 'return_type');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (returnType) {
        sig += ' -> ' + getNodeText(returnType, source);
      }
      return sig;
    },
    isAsync: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'async') return true;
      }
      return false;
    },
    getVisibility: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'visibility_modifier') {
          return child.text.includes('pub') ? 'public' : 'private';
        }
      }
      return 'private'; // Rust defaults to private
    },
  },
  java: {
    functionTypes: [],
    classTypes: ['class_declaration'],
    methodTypes: ['method_declaration', 'constructor_declaration'],
    interfaceTypes: ['interface_declaration'],
    structTypes: [],
    enumTypes: ['enum_declaration'],
    importTypes: ['import_declaration'],
    callTypes: ['method_invocation'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'type',
    getSignature: (node, source) => {
      const params = getChildByField(node, 'parameters');
      const returnType = getChildByField(node, 'type');
      if (!params) return undefined;
      const paramsText = getNodeText(params, source);
      return returnType ? getNodeText(returnType, source) + ' ' + paramsText : paramsText;
    },
    getVisibility: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers') {
          const text = child.text;
          if (text.includes('public')) return 'public';
          if (text.includes('private')) return 'private';
          if (text.includes('protected')) return 'protected';
        }
      }
      return undefined;
    },
    isStatic: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers' && child.text.includes('static')) {
          return true;
        }
      }
      return false;
    },
  },
  c: {
    functionTypes: ['function_definition'],
    classTypes: [],
    methodTypes: [],
    interfaceTypes: [],
    structTypes: ['struct_specifier'],
    enumTypes: ['enum_specifier'],
    importTypes: ['preproc_include'],
    callTypes: ['call_expression'],
    nameField: 'declarator',
    bodyField: 'body',
    paramsField: 'parameters',
  },
  cpp: {
    functionTypes: ['function_definition'],
    classTypes: ['class_specifier'],
    methodTypes: ['function_definition'],
    interfaceTypes: [],
    structTypes: ['struct_specifier'],
    enumTypes: ['enum_specifier'],
    importTypes: ['preproc_include'],
    callTypes: ['call_expression'],
    nameField: 'declarator',
    bodyField: 'body',
    paramsField: 'parameters',
    getVisibility: (node) => {
      // Check for access specifier in parent
      const parent = node.parent;
      if (parent) {
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i);
          if (child?.type === 'access_specifier') {
            const text = child.text;
            if (text.includes('public')) return 'public';
            if (text.includes('private')) return 'private';
            if (text.includes('protected')) return 'protected';
          }
        }
      }
      return undefined;
    },
  },
  csharp: {
    functionTypes: [],
    classTypes: ['class_declaration'],
    methodTypes: ['method_declaration', 'constructor_declaration'],
    interfaceTypes: ['interface_declaration'],
    structTypes: ['struct_declaration'],
    enumTypes: ['enum_declaration'],
    importTypes: ['using_directive'],
    callTypes: ['invocation_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameter_list',
    getVisibility: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifier') {
          const text = child.text;
          if (text === 'public') return 'public';
          if (text === 'private') return 'private';
          if (text === 'protected') return 'protected';
          if (text === 'internal') return 'internal';
        }
      }
      return 'private'; // C# defaults to private
    },
    isStatic: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifier' && child.text === 'static') {
          return true;
        }
      }
      return false;
    },
    isAsync: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifier' && child.text === 'async') {
          return true;
        }
      }
      return false;
    },
  },
  php: {
    functionTypes: ['function_definition'],
    classTypes: ['class_declaration'],
    methodTypes: ['method_declaration'],
    interfaceTypes: ['interface_declaration'],
    structTypes: [],
    enumTypes: ['enum_declaration'],
    importTypes: ['namespace_use_declaration'],
    callTypes: ['function_call_expression', 'member_call_expression', 'scoped_call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    returnField: 'return_type',
    getVisibility: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'visibility_modifier') {
          const text = child.text;
          if (text === 'public') return 'public';
          if (text === 'private') return 'private';
          if (text === 'protected') return 'protected';
        }
      }
      return 'public'; // PHP defaults to public
    },
    isStatic: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'static_modifier') return true;
      }
      return false;
    },
  },
  ruby: {
    functionTypes: ['method'],
    classTypes: ['class'],
    methodTypes: ['method', 'singleton_method'],
    interfaceTypes: [], // Ruby uses modules
    structTypes: [],
    enumTypes: [],
    importTypes: ['call'], // require/require_relative
    callTypes: ['call', 'method_call'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameters',
    getVisibility: (node) => {
      // Ruby visibility is based on preceding visibility modifiers
      let sibling = node.previousNamedSibling;
      while (sibling) {
        if (sibling.type === 'call') {
          const methodName = getChildByField(sibling, 'method');
          if (methodName) {
            const text = methodName.text;
            if (text === 'private') return 'private';
            if (text === 'protected') return 'protected';
            if (text === 'public') return 'public';
          }
        }
        sibling = sibling.previousNamedSibling;
      }
      return 'public';
    },
  },
  swift: {
    functionTypes: ['function_declaration'],
    classTypes: ['class_declaration'],
    methodTypes: ['function_declaration'], // Methods are functions inside classes
    interfaceTypes: ['protocol_declaration'],
    structTypes: ['struct_declaration'],
    enumTypes: ['enum_declaration'],
    importTypes: ['import_declaration'],
    callTypes: ['call_expression'],
    nameField: 'name',
    bodyField: 'body',
    paramsField: 'parameter',
    returnField: 'return_type',
    getSignature: (node, source) => {
      // Swift function signature: func name(params) -> ReturnType
      const params = getChildByField(node, 'parameter');
      const returnType = getChildByField(node, 'return_type');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (returnType) {
        sig += ' -> ' + getNodeText(returnType, source);
      }
      return sig;
    },
    getVisibility: (node) => {
      // Check for visibility modifiers in Swift
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers') {
          const text = child.text;
          if (text.includes('public')) return 'public';
          if (text.includes('private')) return 'private';
          if (text.includes('internal')) return 'internal';
          if (text.includes('fileprivate')) return 'private';
        }
      }
      return 'internal'; // Swift defaults to internal
    },
    isStatic: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers') {
          if (child.text.includes('static') || child.text.includes('class')) {
            return true;
          }
        }
      }
      return false;
    },
    isAsync: (node) => {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers' && child.text.includes('async')) {
          return true;
        }
      }
      return false;
    },
  },
  kotlin: {
    functionTypes: ['function_declaration'],
    classTypes: ['class_declaration'],
    methodTypes: ['function_declaration'], // Methods are functions inside classes
    interfaceTypes: ['class_declaration'], // Interfaces use class_declaration with 'interface' modifier
    structTypes: [], // Kotlin uses data classes
    enumTypes: ['class_declaration'], // Enums use class_declaration with 'enum' modifier
    importTypes: ['import_header'],
    callTypes: ['call_expression'],
    nameField: 'simple_identifier',
    bodyField: 'function_body',
    paramsField: 'function_value_parameters',
    returnField: 'type',
    getSignature: (node, source) => {
      // Kotlin function signature: fun name(params): ReturnType
      const params = getChildByField(node, 'function_value_parameters');
      const returnType = getChildByField(node, 'type');
      if (!params) return undefined;
      let sig = getNodeText(params, source);
      if (returnType) {
        sig += ': ' + getNodeText(returnType, source);
      }
      return sig;
    },
    getVisibility: (node) => {
      // Check for visibility modifiers in Kotlin
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers') {
          const text = child.text;
          if (text.includes('public')) return 'public';
          if (text.includes('private')) return 'private';
          if (text.includes('protected')) return 'protected';
          if (text.includes('internal')) return 'internal';
        }
      }
      return 'public'; // Kotlin defaults to public
    },
    isStatic: (_node) => {
      // Kotlin doesn't have static, uses companion objects
      // Check if inside companion object would require more context
      return false;
    },
    isAsync: (node) => {
      // Kotlin uses suspend keyword for coroutines
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'modifiers' && child.text.includes('suspend')) {
          return true;
        }
      }
      return false;
    },
  },
};

// TSX and JSX use the same extractors as their base languages
EXTRACTORS.tsx = EXTRACTORS.typescript;
EXTRACTORS.jsx = EXTRACTORS.javascript;

/**
 * Extract the name from a node based on language
 */
function extractName(node: SyntaxNode, source: string, extractor: LanguageExtractor): string {
  // Try field name first
  const nameNode = getChildByField(node, extractor.nameField);
  if (nameNode) {
    // Handle complex declarators (C/C++)
    if (nameNode.type === 'function_declarator' || nameNode.type === 'declarator') {
      const innerName = getChildByField(nameNode, 'declarator') || nameNode.namedChild(0);
      return innerName ? getNodeText(innerName, source) : getNodeText(nameNode, source);
    }
    return getNodeText(nameNode, source);
  }

  // Fall back to first identifier child
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (
      child &&
      (child.type === 'identifier' ||
        child.type === 'type_identifier' ||
        child.type === 'simple_identifier' ||
        child.type === 'constant')
    ) {
      return getNodeText(child, source);
    }
  }

  return '<anonymous>';
}

/**
 * TreeSitterExtractor - Main extraction class
 */
export class TreeSitterExtractor {
  private filePath: string;
  private language: Language;
  private source: string;
  private tree: Tree | null = null;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];
  private extractor: LanguageExtractor | null = null;
  private nodeStack: string[] = []; // Stack of parent node IDs

  constructor(filePath: string, source: string, language?: Language) {
    this.filePath = filePath;
    this.source = source;
    this.language = language || detectLanguage(filePath);
    this.extractor = EXTRACTORS[this.language] || null;
  }

  /**
   * Parse and extract from the source code
   */
  extract(): ExtractionResult {
    const startTime = Date.now();

    if (!isLanguageSupported(this.language)) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [
          {
            message: `Unsupported language: ${this.language}`,
            severity: 'error',
          },
        ],
        durationMs: Date.now() - startTime,
      };
    }

    const parser = getParser(this.language);
    if (!parser) {
      return {
        nodes: [],
        edges: [],
        unresolvedReferences: [],
        errors: [
          {
            message: `Failed to get parser for language: ${this.language}`,
            severity: 'error',
          },
        ],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      this.tree = parser.parse(this.source);
      this.visitNode(this.tree.rootNode);
    } catch (error) {
      this.errors.push({
        message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Visit a node and extract information
   */
  private visitNode(node: SyntaxNode): void {
    if (!this.extractor) return;

    const nodeType = node.type;
    let skipChildren = false;

    // Check for function declarations
    // For Python/Ruby, function_definition inside a class should be treated as method
    if (this.extractor.functionTypes.includes(nodeType)) {
      if (this.nodeStack.length > 0 && this.extractor.methodTypes.includes(nodeType)) {
        // Inside a class - treat as method
        this.extractMethod(node);
        skipChildren = true; // extractMethod visits children via visitFunctionBody
      } else {
        this.extractFunction(node);
        skipChildren = true; // extractFunction visits children via visitFunctionBody
      }
    }
    // Check for class declarations
    else if (this.extractor.classTypes.includes(nodeType)) {
      // Swift uses class_declaration for both classes and structs
      // Check for 'struct' child to differentiate
      if (this.language === 'swift' && this.hasChildOfType(node, 'struct')) {
        this.extractStruct(node);
      } else if (this.language === 'swift' && this.hasChildOfType(node, 'enum')) {
        this.extractEnum(node);
      } else {
        this.extractClass(node);
      }
      skipChildren = true; // extractClass visits body children
    }
    // Check for method declarations (only if not already handled by functionTypes)
    else if (this.extractor.methodTypes.includes(nodeType)) {
      this.extractMethod(node);
      skipChildren = true; // extractMethod visits children via visitFunctionBody
    }
    // Check for interface/protocol/trait declarations
    else if (this.extractor.interfaceTypes.includes(nodeType)) {
      this.extractInterface(node);
      skipChildren = true; // extractInterface visits body children
    }
    // Check for struct declarations
    else if (this.extractor.structTypes.includes(nodeType)) {
      this.extractStruct(node);
      skipChildren = true; // extractStruct visits body children
    }
    // Check for enum declarations
    else if (this.extractor.enumTypes.includes(nodeType)) {
      this.extractEnum(node);
      skipChildren = true; // extractEnum visits body children
    }
    // Check for imports
    else if (this.extractor.importTypes.includes(nodeType)) {
      this.extractImport(node);
    }
    // Check for function calls
    else if (this.extractor.callTypes.includes(nodeType)) {
      this.extractCall(node);
    }

    // Visit children (unless the extract method already visited them)
    if (!skipChildren) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          this.visitNode(child);
        }
      }
    }
  }

  /**
   * Create a Node object
   */
  private createNode(
    kind: NodeKind,
    name: string,
    node: SyntaxNode,
    extra?: Partial<Node>
  ): Node {
    const id = generateNodeId(this.filePath, kind, name, node.startPosition.row + 1);

    const newNode: Node = {
      id,
      kind,
      name,
      qualifiedName: this.buildQualifiedName(name),
      filePath: this.filePath,
      language: this.language,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      updatedAt: Date.now(),
      ...extra,
    };

    this.nodes.push(newNode);

    // Add containment edge from parent
    if (this.nodeStack.length > 0) {
      const parentId = this.nodeStack[this.nodeStack.length - 1];
      if (parentId) {
        this.edges.push({
          source: parentId,
          target: id,
          kind: 'contains',
        });
      }
    }

    return newNode;
  }

  /**
   * Build qualified name from node stack
   */
  private buildQualifiedName(name: string): string {
    // Get names from the node stack
    const parts: string[] = [this.filePath];
    for (const nodeId of this.nodeStack) {
      const node = this.nodes.find((n) => n.id === nodeId);
      if (node) {
        parts.push(node.name);
      }
    }
    parts.push(name);
    return parts.join('::');
  }

  /**
   * Check if a node has a child of a specific type
   */
  private hasChildOfType(node: SyntaxNode, type: string): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === type) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extract a function
   */
  private extractFunction(node: SyntaxNode): void {
    if (!this.extractor) return;

    const name = extractName(node, this.source, this.extractor);
    if (name === '<anonymous>') return; // Skip anonymous functions

    const docstring = getPrecedingDocstring(node, this.source);
    const signature = this.extractor.getSignature?.(node, this.source);
    const visibility = this.extractor.getVisibility?.(node);
    const isExported = this.extractor.isExported?.(node, this.source);
    const isAsync = this.extractor.isAsync?.(node);
    const isStatic = this.extractor.isStatic?.(node);

    const funcNode = this.createNode('function', name, node, {
      docstring,
      signature,
      visibility,
      isExported,
      isAsync,
      isStatic,
    });

    // Push to stack and visit body
    this.nodeStack.push(funcNode.id);
    const body = getChildByField(node, this.extractor.bodyField);
    if (body) {
      this.visitFunctionBody(body, funcNode.id);
    }
    this.nodeStack.pop();
  }

  /**
   * Extract a class
   */
  private extractClass(node: SyntaxNode): void {
    if (!this.extractor) return;

    const name = extractName(node, this.source, this.extractor);
    const docstring = getPrecedingDocstring(node, this.source);
    const visibility = this.extractor.getVisibility?.(node);
    const isExported = this.extractor.isExported?.(node, this.source);

    const classNode = this.createNode('class', name, node, {
      docstring,
      visibility,
      isExported,
    });

    // Extract extends/implements
    this.extractInheritance(node, classNode.id);

    // Push to stack and visit body
    this.nodeStack.push(classNode.id);
    const body = getChildByField(node, this.extractor.bodyField) || node;

    // Visit all children for methods and properties
    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i);
      if (child) {
        this.visitNode(child);
      }
    }
    this.nodeStack.pop();
  }

  /**
   * Extract a method
   */
  private extractMethod(node: SyntaxNode): void {
    if (!this.extractor) return;

    // For most languages, only extract as method if inside a class
    // But Go methods are top-level with a receiver, so always treat them as methods
    if (this.nodeStack.length === 0 && this.language !== 'go') {
      // Top-level and not Go, treat as function
      this.extractFunction(node);
      return;
    }

    const name = extractName(node, this.source, this.extractor);
    const docstring = getPrecedingDocstring(node, this.source);
    const signature = this.extractor.getSignature?.(node, this.source);
    const visibility = this.extractor.getVisibility?.(node);
    const isAsync = this.extractor.isAsync?.(node);
    const isStatic = this.extractor.isStatic?.(node);

    const methodNode = this.createNode('method', name, node, {
      docstring,
      signature,
      visibility,
      isAsync,
      isStatic,
    });

    // Push to stack and visit body
    this.nodeStack.push(methodNode.id);
    const body = getChildByField(node, this.extractor.bodyField);
    if (body) {
      this.visitFunctionBody(body, methodNode.id);
    }
    this.nodeStack.pop();
  }

  /**
   * Extract an interface/protocol/trait
   */
  private extractInterface(node: SyntaxNode): void {
    if (!this.extractor) return;

    const name = extractName(node, this.source, this.extractor);
    const docstring = getPrecedingDocstring(node, this.source);
    const isExported = this.extractor.isExported?.(node, this.source);

    // Determine kind based on language
    let kind: NodeKind = 'interface';
    if (this.language === 'rust') kind = 'trait';

    this.createNode(kind, name, node, {
      docstring,
      isExported,
    });
  }

  /**
   * Extract a struct
   */
  private extractStruct(node: SyntaxNode): void {
    if (!this.extractor) return;

    const name = extractName(node, this.source, this.extractor);
    const docstring = getPrecedingDocstring(node, this.source);
    const visibility = this.extractor.getVisibility?.(node);
    const isExported = this.extractor.isExported?.(node, this.source);

    const structNode = this.createNode('struct', name, node, {
      docstring,
      visibility,
      isExported,
    });

    // Push to stack for field extraction
    this.nodeStack.push(structNode.id);
    const body = getChildByField(node, this.extractor.bodyField) || node;
    for (let i = 0; i < body.namedChildCount; i++) {
      const child = body.namedChild(i);
      if (child) {
        this.visitNode(child);
      }
    }
    this.nodeStack.pop();
  }

  /**
   * Extract an enum
   */
  private extractEnum(node: SyntaxNode): void {
    if (!this.extractor) return;

    const name = extractName(node, this.source, this.extractor);
    const docstring = getPrecedingDocstring(node, this.source);
    const visibility = this.extractor.getVisibility?.(node);
    const isExported = this.extractor.isExported?.(node, this.source);

    this.createNode('enum', name, node, {
      docstring,
      visibility,
      isExported,
    });
  }

  /**
   * Extract an import
   */
  private extractImport(node: SyntaxNode): void {
    // Create an edge to track the import
    // For now, we'll create unresolved references
    const importText = getNodeText(node, this.source);

    // Extract module/package name based on language
    let moduleName = '';

    if (this.language === 'typescript' || this.language === 'javascript') {
      const source = getChildByField(node, 'source');
      if (source) {
        moduleName = getNodeText(source, this.source).replace(/['"]/g, '');
      }
    } else if (this.language === 'python') {
      const module = getChildByField(node, 'module_name') || node.namedChild(0);
      if (module) {
        moduleName = getNodeText(module, this.source);
      }
    } else if (this.language === 'go') {
      const path = node.namedChild(0);
      if (path) {
        moduleName = getNodeText(path, this.source).replace(/['"]/g, '');
      }
    } else {
      // Generic extraction
      moduleName = importText;
    }

    if (moduleName && this.nodeStack.length > 0) {
      const parentId = this.nodeStack[this.nodeStack.length - 1];
      if (parentId) {
        this.unresolvedReferences.push({
          fromNodeId: parentId,
          referenceName: moduleName,
          referenceKind: 'imports',
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
    }
  }

  /**
   * Extract a function call
   */
  private extractCall(node: SyntaxNode): void {
    if (this.nodeStack.length === 0) return;

    const callerId = this.nodeStack[this.nodeStack.length - 1];
    if (!callerId) return;

    // Get the function/method being called
    let calleeName = '';
    const func = getChildByField(node, 'function') || node.namedChild(0);

    if (func) {
      if (func.type === 'member_expression' || func.type === 'attribute') {
        // Method call: obj.method()
        const property = getChildByField(func, 'property') || func.namedChild(1);
        if (property) {
          calleeName = getNodeText(property, this.source);
        }
      } else if (func.type === 'scoped_identifier' || func.type === 'scoped_call_expression') {
        // Scoped call: Module::function()
        calleeName = getNodeText(func, this.source);
      } else {
        calleeName = getNodeText(func, this.source);
      }
    }

    if (calleeName) {
      this.unresolvedReferences.push({
        fromNodeId: callerId,
        referenceName: calleeName,
        referenceKind: 'calls',
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
      });
    }
  }

  /**
   * Visit function body and extract calls
   */
  private visitFunctionBody(body: SyntaxNode, _functionId: string): void {
    if (!this.extractor) return;

    // Recursively find all call expressions
    const visitForCalls = (node: SyntaxNode): void => {
      if (this.extractor!.callTypes.includes(node.type)) {
        this.extractCall(node);
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          visitForCalls(child);
        }
      }
    };

    visitForCalls(body);
  }

  /**
   * Extract inheritance relationships
   */
  private extractInheritance(node: SyntaxNode, classId: string): void {
    // Look for extends/implements clauses
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;

      if (
        child.type === 'extends_clause' ||
        child.type === 'class_heritage' ||
        child.type === 'superclass'
      ) {
        // Extract parent class name
        const superclass = child.namedChild(0);
        if (superclass) {
          const name = getNodeText(superclass, this.source);
          this.unresolvedReferences.push({
            fromNodeId: classId,
            referenceName: name,
            referenceKind: 'extends',
            line: child.startPosition.row + 1,
            column: child.startPosition.column,
          });
        }
      }

      if (
        child.type === 'implements_clause' ||
        child.type === 'class_interface_clause'
      ) {
        // Extract implemented interfaces
        for (let j = 0; j < child.namedChildCount; j++) {
          const iface = child.namedChild(j);
          if (iface) {
            const name = getNodeText(iface, this.source);
            this.unresolvedReferences.push({
              fromNodeId: classId,
              referenceName: name,
              referenceKind: 'implements',
              line: iface.startPosition.row + 1,
              column: iface.startPosition.column,
            });
          }
        }
      }
    }
  }
}

/**
 * Extract nodes and edges from source code
 */
export function extractFromSource(
  filePath: string,
  source: string,
  language?: Language
): ExtractionResult {
  const extractor = new TreeSitterExtractor(filePath, source, language);
  return extractor.extract();
}
