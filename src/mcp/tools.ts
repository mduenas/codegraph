/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the CodeGraph MCP server.
 */

import CodeGraph from '../index';
import type { Node, SearchResult, Subgraph, TaskContext, NodeKind } from '../types';
import { clamp } from '../utils';

/**
 * MCP Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
  };
}

interface PropertySchema {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * All CodeGraph MCP tools
 *
 * Designed for minimal context usage - use codegraph_context as the primary tool,
 * and only use other tools for targeted follow-up queries.
 */
export const tools: ToolDefinition[] = [
  {
    name: 'codegraph_search',
    description: 'Quick symbol search by name. Returns locations only (no code). Use codegraph_context instead for comprehensive task context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol name or partial name (e.g., "auth", "signIn", "UserService")',
        },
        kind: {
          type: 'string',
          description: 'Filter by node kind',
          enum: ['function', 'method', 'class', 'interface', 'type', 'variable', 'route', 'component'],
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'codegraph_context',
    description: 'PRIMARY TOOL: Build comprehensive context for a task. Returns entry points, related symbols, and key code - often enough to understand the codebase without additional tool calls. NOTE: This provides CODE context, not product requirements. For new features, still clarify UX/behavior questions with the user before implementing.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Description of the task, bug, or feature to build context for',
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum symbols to include (default: 20)',
          default: 20,
        },
        includeCode: {
          type: 'boolean',
          description: 'Include code snippets for key symbols (default: true)',
          default: true,
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'codegraph_callers',
    description: 'Find all functions/methods that call a specific symbol. Useful for understanding usage patterns and impact of changes.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callers for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callers to return (default: 20)',
          default: 20,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'codegraph_callees',
    description: 'Find all functions/methods that a specific symbol calls. Useful for understanding dependencies and code flow.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the function, method, or class to find callees for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of callees to return (default: 20)',
          default: 20,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'codegraph_impact',
    description: 'Analyze the impact radius of changing a symbol. Shows what code could be affected by modifications.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to analyze impact for',
        },
        depth: {
          type: 'number',
          description: 'How many levels of dependencies to traverse (default: 2)',
          default: 2,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'codegraph_node',
    description: 'Get detailed information about a specific code symbol. Use includeCode=true only when you need the full source code - otherwise just get location and signature to minimize context usage.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Name of the symbol to get details for',
        },
        includeCode: {
          type: 'boolean',
          description: 'Include full source code (default: false to minimize context)',
          default: false,
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'codegraph_status',
    description: 'Get the status of the CodeGraph index, including statistics about indexed files, nodes, and edges.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Tool handler that executes tools against a CodeGraph instance
 */
export class ToolHandler {
  constructor(private cg: CodeGraph) {}

  /**
   * Execute a tool by name
   */
  async execute(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'codegraph_search':
          return await this.handleSearch(args);
        case 'codegraph_context':
          return await this.handleContext(args);
        case 'codegraph_callers':
          return await this.handleCallers(args);
        case 'codegraph_callees':
          return await this.handleCallees(args);
        case 'codegraph_impact':
          return await this.handleImpact(args);
        case 'codegraph_node':
          return await this.handleNode(args);
        case 'codegraph_status':
          return await this.handleStatus();
        default:
          return this.errorResult(`Unknown tool: ${toolName}`);
      }
    } catch (err) {
      return this.errorResult(`Tool execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Handle codegraph_search
   */
  private async handleSearch(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;
    const kind = args.kind as string | undefined;
    const limit = clamp((args.limit as number) || 10, 1, 100);

    const results = this.cg.searchNodes(query, {
      limit,
      kinds: kind ? [kind as NodeKind] : undefined,
    });

    if (results.length === 0) {
      return this.textResult(`No results found for "${query}"`);
    }

    const formatted = this.formatSearchResults(results);
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Handle codegraph_context
   */
  private async handleContext(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    const maxNodes = (args.maxNodes as number) || 20;
    const includeCode = args.includeCode !== false;

    const context = await this.cg.buildContext(task, {
      maxNodes,
      includeCode,
      format: 'markdown',
    });

    // Detect if this looks like a feature request (vs bug fix or exploration)
    const isFeatureQuery = this.looksLikeFeatureRequest(task);
    const reminder = isFeatureQuery
      ? '\n\n⚠️ **Ask user:** UX preferences, edge cases, acceptance criteria'
      : '';

    // buildContext returns string when format is 'markdown'
    if (typeof context === 'string') {
      return this.textResult(context + reminder);
    }

    // If it returns TaskContext, format it
    return this.textResult(this.formatTaskContext(context) + reminder);
  }

  /**
   * Heuristic to detect if a query looks like a feature request
   */
  private looksLikeFeatureRequest(task: string): boolean {
    const featureKeywords = [
      'add', 'create', 'implement', 'build', 'enable', 'allow',
      'new feature', 'support for', 'ability to', 'want to',
      'should be able', 'need to add', 'swap', 'edit', 'modify'
    ];
    const bugKeywords = [
      'fix', 'bug', 'error', 'broken', 'crash', 'issue', 'problem',
      'not working', 'fails', 'undefined', 'null'
    ];
    const explorationKeywords = [
      'how does', 'where is', 'what is', 'find', 'show me',
      'explain', 'understand', 'explore'
    ];

    const lowerTask = task.toLowerCase();

    // If it's clearly a bug or exploration, not a feature
    if (bugKeywords.some(k => lowerTask.includes(k))) return false;
    if (explorationKeywords.some(k => lowerTask.includes(k))) return false;

    // If it matches feature keywords, it's likely a feature request
    return featureKeywords.some(k => lowerTask.includes(k));
  }

  /**
   * Handle codegraph_callers
   */
  private async handleCallers(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const limit = clamp((args.limit as number) || 20, 1, 100);

    const match = this.findSymbol(this.cg, symbol);
    if (!match) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const callers = this.cg.getCallers(match.node.id);

    if (callers.length === 0) {
      return this.textResult(`No callers found for "${symbol}"${match.note}`);
    }

    const callerNodes = callers.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(callerNodes, `Callers of ${symbol}`) + match.note;
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Handle codegraph_callees
   */
  private async handleCallees(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const limit = clamp((args.limit as number) || 20, 1, 100);

    const match = this.findSymbol(this.cg, symbol);
    if (!match) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const callees = this.cg.getCallees(match.node.id);

    if (callees.length === 0) {
      return this.textResult(`No callees found for "${symbol}"${match.note}`);
    }

    const calleeNodes = callees.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(calleeNodes, `Callees of ${symbol}`) + match.note;
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Handle codegraph_impact
   */
  private async handleImpact(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const depth = clamp((args.depth as number) || 2, 1, 10);

    const match = this.findSymbol(this.cg, symbol);
    if (!match) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const impact = this.cg.getImpactRadius(match.node.id, depth);

    const formatted = this.formatImpact(symbol, impact) + match.note;
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Handle codegraph_node
   */
  private async handleNode(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    // Default to false to minimize context usage
    const includeCode = args.includeCode === true;

    const match = this.findSymbol(this.cg, symbol);
    if (!match) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    let code: string | null = null;

    if (includeCode) {
      code = await this.cg.getCode(match.node.id);
    }

    const formatted = this.formatNodeDetails(match.node, code) + match.note;
    return this.textResult(this.truncateOutput(formatted));
  }

  /**
   * Handle codegraph_status
   */
  private async handleStatus(): Promise<ToolResult> {
    const stats = this.cg.getStats();

    const lines: string[] = [
      '## CodeGraph Status',
      '',
      `**Files indexed:** ${stats.fileCount}`,
      `**Total nodes:** ${stats.nodeCount}`,
      `**Total edges:** ${stats.edgeCount}`,
      `**Database size:** ${(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
      '',
      '### Nodes by Kind:',
    ];

    for (const [kind, count] of Object.entries(stats.nodesByKind)) {
      if ((count as number) > 0) {
        lines.push(`- ${kind}: ${count}`);
      }
    }

    lines.push('', '### Languages:');
    for (const [lang, count] of Object.entries(stats.filesByLanguage)) {
      if ((count as number) > 0) {
        lines.push(`- ${lang}: ${count}`);
      }
    }

    return this.textResult(lines.join('\n'));
  }

  // =========================================================================
  // Symbol resolution helpers
  // =========================================================================

  /**
   * Find a symbol by name, handling disambiguation when multiple matches exist.
   * Returns the best match and a note about alternatives if any.
   */
  private findSymbol(cg: CodeGraph, symbol: string): { node: Node; note: string } | null {
    const results = cg.searchNodes(symbol, { limit: 10 });

    if (results.length === 0 || !results[0]) {
      return null;
    }

    // If only one result, or first is an exact name match, use it directly
    const exactMatches = results.filter(r => r.node.name === symbol);

    if (exactMatches.length === 1) {
      return { node: exactMatches[0]!.node, note: '' };
    }

    if (exactMatches.length > 1) {
      // Multiple exact matches - pick first, note the others
      const picked = exactMatches[0]!.node;
      const others = exactMatches.slice(1).map(r =>
        `${r.node.name} (${r.node.kind}) at ${r.node.filePath}:${r.node.startLine}`
      );
      const note = `\n\n> **Note:** ${exactMatches.length} symbols named "${symbol}". Showing results for \`${picked.filePath}:${picked.startLine}\`. Others: ${others.join(', ')}`;
      return { node: picked, note };
    }

    // No exact match, use best fuzzy match
    return { node: results[0]!.node, note: '' };
  }

  /**
   * Maximum output length to prevent context bloat (characters)
   */
  private readonly MAX_OUTPUT_LENGTH = 15000;

  /**
   * Truncate output if it exceeds the maximum length
   */
  private truncateOutput(text: string): string {
    if (text.length <= this.MAX_OUTPUT_LENGTH) return text;
    const truncated = text.slice(0, this.MAX_OUTPUT_LENGTH);
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = lastNewline > this.MAX_OUTPUT_LENGTH * 0.8 ? lastNewline : this.MAX_OUTPUT_LENGTH;
    return truncated.slice(0, cutPoint) + '\n\n... (output truncated)';
  }

  // =========================================================================
  // Formatting helpers (compact by default to reduce context usage)
  // =========================================================================

  private formatSearchResults(results: SearchResult[]): string {
    const lines: string[] = [`## Search Results (${results.length} found)`, ''];

    for (const result of results) {
      const { node } = result;
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact format: one line per result with key info
      lines.push(`### ${node.name} (${node.kind})`);
      lines.push(`${node.filePath}${location}`);
      if (node.signature) lines.push(`\`${node.signature}\``);
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatNodeList(nodes: Node[], title: string): string {
    const lines: string[] = [`## ${title} (${nodes.length} found)`, ''];

    for (const node of nodes) {
      const location = node.startLine ? `:${node.startLine}` : '';
      // Compact: just name, kind, location
      lines.push(`- ${node.name} (${node.kind}) - ${node.filePath}${location}`);
    }

    return lines.join('\n');
  }

  private formatImpact(symbol: string, impact: Subgraph): string {
    const nodeCount = impact.nodes.size;

    // Compact format: just list affected symbols grouped by file
    const lines: string[] = [
      `## Impact: "${symbol}" affects ${nodeCount} symbols`,
      '',
    ];

    // Group by file
    const byFile = new Map<string, Node[]>();
    for (const node of impact.nodes.values()) {
      const existing = byFile.get(node.filePath) || [];
      existing.push(node);
      byFile.set(node.filePath, existing);
    }

    for (const [file, nodes] of byFile) {
      lines.push(`**${file}:**`);
      // Compact: inline list
      const nodeList = nodes.map(n => `${n.name}:${n.startLine}`).join(', ');
      lines.push(nodeList);
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatNodeDetails(node: Node, code: string | null): string {
    const location = node.startLine ? `:${node.startLine}` : '';
    const lines: string[] = [
      `## ${node.name} (${node.kind})`,
      '',
      `**Location:** ${node.filePath}${location}`,
    ];

    if (node.signature) {
      lines.push(`**Signature:** \`${node.signature}\``);
    }

    // Only include docstring if it's short and useful
    if (node.docstring && node.docstring.length < 200) {
      lines.push('', node.docstring);
    }

    if (code) {
      lines.push('', '```' + node.language, code, '```');
    }

    return lines.join('\n');
  }

  private formatTaskContext(context: TaskContext): string {
    return context.summary || 'No context found';
  }

  private textResult(text: string): ToolResult {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private errorResult(message: string): ToolResult {
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
}
