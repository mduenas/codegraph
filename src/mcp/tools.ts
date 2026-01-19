/**
 * MCP Tool Definitions
 *
 * Defines the tools exposed by the CodeGraph MCP server.
 */

import CodeGraph from '../index';
import type { Node, SearchResult, Subgraph, TaskContext, NodeKind } from '../types';

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
  {
    name: 'codegraph_explore',
    description: 'RECOMMENDED FOR COMPLEX TASKS: Deep exploration that returns a condensed brief. Internally performs multiple searches, call graph analysis, and impact assessment - then synthesizes results into a compact summary. Use this instead of multiple codegraph_* calls to keep your context clean. Returns: key files, critical functions, data flow summary, and suggested approach.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Detailed description of the feature, bug, or task to explore',
        },
        focus: {
          type: 'string',
          description: 'Optional focus area: "architecture" (structure & patterns), "implementation" (specific code), or "impact" (what would change). Default: auto-detect.',
          enum: ['architecture', 'implementation', 'impact'],
        },
        keywords: {
          type: 'string',
          description: 'Optional comma-separated keywords to search for (e.g., "bundle,swap,subscription")',
        },
      },
      required: ['task'],
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
        case 'codegraph_explore':
          return await this.handleExplore(args);
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
    const limit = (args.limit as number) || 10;

    const results = this.cg.searchNodes(query, {
      limit,
      kinds: kind ? [kind as NodeKind] : undefined,
    });

    if (results.length === 0) {
      return this.textResult(`No results found for "${query}"`);
    }

    const formatted = this.formatSearchResults(results);
    return this.textResult(formatted);
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
      ? '\n\n---\n**Note:** This is code context only. For new features, consider asking the user about UX preferences, edge cases, and acceptance criteria before implementing.'
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
    const limit = (args.limit as number) || 20;

    // First find the node by name
    const results = this.cg.searchNodes(symbol, { limit: 1 });
    if (results.length === 0 || !results[0]) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const node = results[0].node;
    const callers = this.cg.getCallers(node.id);

    if (callers.length === 0) {
      return this.textResult(`No callers found for "${symbol}"`);
    }

    // Extract just the nodes from the { node, edge } tuples
    const callerNodes = callers.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(callerNodes, `Callers of ${symbol}`);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_callees
   */
  private async handleCallees(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const limit = (args.limit as number) || 20;

    // First find the node by name
    const results = this.cg.searchNodes(symbol, { limit: 1 });
    if (results.length === 0 || !results[0]) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const node = results[0].node;
    const callees = this.cg.getCallees(node.id);

    if (callees.length === 0) {
      return this.textResult(`No callees found for "${symbol}"`);
    }

    // Extract just the nodes from the { node, edge } tuples
    const calleeNodes = callees.slice(0, limit).map(c => c.node);
    const formatted = this.formatNodeList(calleeNodes, `Callees of ${symbol}`);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_impact
   */
  private async handleImpact(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    const depth = (args.depth as number) || 2;

    // First find the node by name
    const results = this.cg.searchNodes(symbol, { limit: 1 });
    if (results.length === 0 || !results[0]) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const node = results[0].node;
    const impact = this.cg.getImpactRadius(node.id, depth);

    const formatted = this.formatImpact(symbol, impact);
    return this.textResult(formatted);
  }

  /**
   * Handle codegraph_node
   */
  private async handleNode(args: Record<string, unknown>): Promise<ToolResult> {
    const symbol = args.symbol as string;
    // Default to false to minimize context usage
    const includeCode = args.includeCode === true;

    // Find the node by name
    const results = this.cg.searchNodes(symbol, { limit: 1 });
    if (results.length === 0 || !results[0]) {
      return this.textResult(`Symbol "${symbol}" not found in the codebase`);
    }

    const node = results[0].node;
    let code: string | null = null;

    if (includeCode) {
      code = await this.cg.getCode(node.id);
    }

    const formatted = this.formatNodeDetails(node, code);
    return this.textResult(formatted);
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

  /**
   * Handle codegraph_explore - the "sub-agent" that does intensive exploration
   * and returns a condensed brief
   */
  private async handleExplore(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    const focus = args.focus as string | undefined;
    const keywordsArg = args.keywords as string | undefined;

    // Phase 1: Extract search terms
    const keywords = this.extractKeywords(task, keywordsArg);

    // Phase 2: Find relevant symbols (internal, not returned directly)
    const symbolMap = new Map<string, Node>();
    const fileSet = new Set<string>();

    for (const keyword of keywords.slice(0, 5)) { // Limit to 5 keywords
      const results = this.cg.searchNodes(keyword, { limit: 10 });
      for (const r of results) {
        if (!symbolMap.has(r.node.id)) {
          symbolMap.set(r.node.id, r.node);
          fileSet.add(r.node.filePath);
        }
      }
    }

    // Phase 3: Analyze call relationships for top symbols
    const callGraphInsights: string[] = [];
    const topSymbols = Array.from(symbolMap.values())
      .filter(n => n.kind === 'function' || n.kind === 'method' || n.kind === 'component')
      .slice(0, 5);

    for (const symbol of topSymbols) {
      const callers = this.cg.getCallers(symbol.id);
      const callees = this.cg.getCallees(symbol.id);

      if (callers.length > 0 || callees.length > 0) {
        const callerNames = callers.slice(0, 3).map(c => c.node.name).join(', ');
        const calleeNames = callees.slice(0, 3).map(c => c.node.name).join(', ');

        let insight = `**${symbol.name}**`;
        if (callers.length > 0) insight += ` ← called by: ${callerNames}${callers.length > 3 ? '...' : ''}`;
        if (callees.length > 0) insight += ` → calls: ${calleeNames}${callees.length > 3 ? '...' : ''}`;
        callGraphInsights.push(insight);
      }
    }

    // Phase 4: Identify key entry points and patterns
    const components = Array.from(symbolMap.values()).filter(n => n.kind === 'component');
    const routes = Array.from(symbolMap.values()).filter(n => n.kind === 'route');
    const interfaces = Array.from(symbolMap.values()).filter(n => n.kind === 'interface' || n.kind === 'type_alias');
    const functions = Array.from(symbolMap.values()).filter(n => n.kind === 'function' || n.kind === 'method');

    // Phase 5: Build condensed brief
    const brief = this.buildExploreBrief({
      task,
      focus,
      keywords,
      files: Array.from(fileSet),
      components,
      routes,
      interfaces,
      functions,
      callGraphInsights,
      totalSymbols: symbolMap.size,
    });

    // Add feature request reminder if applicable
    const isFeatureQuery = this.looksLikeFeatureRequest(task);
    const reminder = isFeatureQuery
      ? '\n\n---\n**Before implementing:** Clarify with the user: UX preferences, edge cases, error handling, and acceptance criteria.'
      : '';

    return this.textResult(brief + reminder);
  }

  /**
   * Extract keywords from task description
   */
  private extractKeywords(task: string, explicitKeywords?: string): string[] {
    const keywords: string[] = [];

    // Add explicit keywords first
    if (explicitKeywords) {
      keywords.push(...explicitKeywords.split(',').map(k => k.trim()).filter(Boolean));
    }

    // Extract likely code identifiers from task (camelCase, PascalCase, snake_case)
    const identifierPattern = /\b([A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[a-z]+_[a-z_]+)\b/g;
    const matches = task.match(identifierPattern) || [];
    keywords.push(...matches);

    // Extract quoted terms
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    let match;
    while ((match = quotedPattern.exec(task)) !== null) {
      const quoted = match[1] || match[2];
      if (quoted) keywords.push(quoted);
    }

    // Extract domain-specific terms (nouns that might be code concepts)
    const commonTerms = task.toLowerCase()
      .split(/\s+/)
      .filter(word =>
        word.length > 3 &&
        !['this', 'that', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should', 'when', 'where', 'what', 'which', 'their', 'there', 'these', 'those', 'about', 'into', 'then', 'than', 'some', 'other', 'after', 'before'].includes(word)
      );
    keywords.push(...commonTerms);

    // Deduplicate and return
    return [...new Set(keywords)];
  }

  /**
   * Build a condensed exploration brief
   */
  private buildExploreBrief(data: {
    task: string;
    focus?: string;
    keywords: string[];
    files: string[];
    components: Node[];
    routes: Node[];
    interfaces: Node[];
    functions: Node[];
    callGraphInsights: string[];
    totalSymbols: number;
  }): string {
    const lines: string[] = [
      '## Exploration Brief',
      '',
      `**Task:** ${data.task}`,
      `**Found:** ${data.totalSymbols} relevant symbols across ${data.files.length} files`,
      '',
    ];

    // Key files (grouped by directory)
    if (data.files.length > 0) {
      lines.push('### Key Files');
      const topFiles = data.files.slice(0, 10);
      for (const file of topFiles) {
        lines.push(`- ${file}`);
      }
      if (data.files.length > 10) {
        lines.push(`- ... and ${data.files.length - 10} more`);
      }
      lines.push('');
    }

    // Entry points
    const entryPoints: string[] = [];
    if (data.components.length > 0) {
      entryPoints.push(`**Components:** ${data.components.slice(0, 5).map(n => `${n.name} (${n.filePath}:${n.startLine})`).join(', ')}`);
    }
    if (data.routes.length > 0) {
      entryPoints.push(`**Routes:** ${data.routes.slice(0, 5).map(n => `${n.name} (${n.filePath}:${n.startLine})`).join(', ')}`);
    }
    if (entryPoints.length > 0) {
      lines.push('### Entry Points');
      lines.push(...entryPoints);
      lines.push('');
    }

    // Key types/interfaces
    if (data.interfaces.length > 0) {
      lines.push('### Key Types');
      for (const iface of data.interfaces.slice(0, 5)) {
        lines.push(`- **${iface.name}** - ${iface.filePath}:${iface.startLine}`);
      }
      lines.push('');
    }

    // Key functions
    if (data.functions.length > 0) {
      lines.push('### Key Functions');
      for (const fn of data.functions.slice(0, 8)) {
        const sig = fn.signature ? ` - \`${fn.signature.slice(0, 60)}${fn.signature.length > 60 ? '...' : ''}\`` : '';
        lines.push(`- **${fn.name}** (${fn.filePath}:${fn.startLine})${sig}`);
      }
      lines.push('');
    }

    // Call graph insights
    if (data.callGraphInsights.length > 0) {
      lines.push('### Data Flow');
      for (const insight of data.callGraphInsights.slice(0, 6)) {
        lines.push(`- ${insight}`);
      }
      lines.push('');
    }

    // Suggested files to read (actionable)
    lines.push('### Suggested Next Steps');
    lines.push('Read these files for implementation details:');
    const suggestedFiles = data.files.slice(0, 3);
    for (const file of suggestedFiles) {
      lines.push(`1. \`${file}\``);
    }

    return lines.join('\n');
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
