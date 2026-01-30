/**
 * CLAUDE.md template for CodeGraph instructions
 *
 * This template is injected into ~/.claude/CLAUDE.md (global) or ./.claude/CLAUDE.md (local)
 * Keep this in sync with the README.md "Recommended: Add Global Instructions" section
 */

// Markers to identify CodeGraph section for updates
export const CODEGRAPH_SECTION_START = '<!-- CODEGRAPH_START -->';
export const CODEGRAPH_SECTION_END = '<!-- CODEGRAPH_END -->';

export const CLAUDE_MD_TEMPLATE = `${CODEGRAPH_SECTION_START}
## CodeGraph

CodeGraph builds a semantic knowledge graph of codebases for faster, smarter code exploration.

### If \`.codegraph/\` exists in the project

**Use codegraph tools for faster exploration.** These tools provide instant lookups via the code graph instead of scanning files:

| Tool | Use For |
|------|---------|
| \`codegraph_search\` | Find symbols by name (functions, classes, types) |
| \`codegraph_context\` | Get relevant code context for a task |
| \`codegraph_callers\` | Find what calls a function |
| \`codegraph_callees\` | Find what a function calls |
| \`codegraph_impact\` | See what's affected by changing a symbol |
| \`codegraph_node\` | Get details + source code for a symbol |

**When spawning Explore agents in a codegraph-enabled project:**

Tell the Explore agent to use codegraph tools for faster exploration.

**For quick lookups in the main session:**
- Use \`codegraph_search\` instead of grep for finding symbols
- Use \`codegraph_callers\`/\`codegraph_callees\` to trace code flow
- Use \`codegraph_impact\` before making changes to see what's affected

### If \`.codegraph/\` does NOT exist

At the start of a session, ask the user if they'd like to initialize CodeGraph:

"I notice this project doesn't have CodeGraph initialized. Would you like me to run \`codegraph init -i\` to build a code knowledge graph?"
${CODEGRAPH_SECTION_END}`;

/**
 * Copilot instructions template
 * Written to .github/copilot-instructions.md
 */
export const COPILOT_INSTRUCTIONS_TEMPLATE = `${CODEGRAPH_SECTION_START}
## CodeGraph

CodeGraph builds a semantic knowledge graph of codebases for faster, smarter code exploration.

### If \`.codegraph/\` exists in the project

**Use codegraph MCP tools for faster exploration.** These tools provide instant lookups via the code graph instead of scanning files:

| Tool | Use For |
|------|---------|
| \`codegraph_search\` | Find symbols by name (functions, classes, types) |
| \`codegraph_context\` | Get relevant code context for a task |
| \`codegraph_callers\` | Find what calls a function |
| \`codegraph_callees\` | Find what a function calls |
| \`codegraph_impact\` | See what's affected by changing a symbol |
| \`codegraph_node\` | Get details + source code for a symbol |

**For quick lookups:**
- Use \`codegraph_search\` instead of grep for finding symbols
- Use \`codegraph_callers\`/\`codegraph_callees\` to trace code flow
- Use \`codegraph_impact\` before making changes to see what's affected

### If \`.codegraph/\` does NOT exist

At the start of a session, suggest initializing CodeGraph:

"I notice this project doesn't have CodeGraph initialized. You can run \`codegraph init -i\` to build a code knowledge graph for faster exploration."
${CODEGRAPH_SECTION_END}`;
