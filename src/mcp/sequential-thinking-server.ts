#!/usr/bin/env node
// Sequential Thinking MCP Server - Provides structured reasoning for complex analysis
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface ThoughtEntry {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  isRevision: boolean;
  revisesThought: number | null;
  branchFromThought: number | null;
  branchId: string | null;
  needsMoreThoughts: boolean;
}

const thoughtHistory: ThoughtEntry[] = [];
const branches: Record<string, ThoughtEntry[]> = {};

function processThought(input: ThoughtEntry): {
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  branches: string[];
  thoughtHistoryLength: number;
} {
  // Adjust total if we've exceeded the estimate
  if (input.thoughtNumber > input.totalThoughts) {
    input.totalThoughts = input.thoughtNumber;
  }

  // Store in history
  thoughtHistory.push(input);

  // Track branches
  if (input.branchId) {
    if (!branches[input.branchId]) {
      branches[input.branchId] = [];
    }
    branches[input.branchId]!.push(input);
  }

  return {
    thoughtNumber: input.thoughtNumber,
    totalThoughts: input.totalThoughts,
    nextThoughtNeeded: input.needsMoreThoughts,
    branches: Object.keys(branches),
    thoughtHistoryLength: thoughtHistory.length,
  };
}

const server = new McpServer({
  name: "Sequential Thinking Server",
  version: "0.0.1",
});

server.tool(
  "sequentialthinking",
  `A tool for dynamic, reflective problem-solving through structured sequential thoughts.

Use this tool to break down complex problems into a series of thoughts, where each thought
builds on previous ones. You can revise earlier thoughts, branch into alternative paths,
and adjust the total number of thoughts as understanding deepens.

When to use this tool:
- Analyzing code for security vulnerabilities or bugs (think through attack vectors)
- Evaluating architectural decisions (weigh tradeoffs systematically)
- Debugging complex issues (trace execution paths step by step)
- Planning multi-step changes (think through dependencies and ordering)
- Reviewing code with multiple interacting concerns

Each thought should be a complete, self-contained reasoning step. The tool tracks your
thought history and supports revision and branching for non-linear analysis.`,
  {
    thought: z
      .string()
      .describe(
        "The content of the current thinking step — a complete reasoning unit",
      ),
    thoughtNumber: z
      .number()
      .int()
      .min(1)
      .describe("The sequence number of this thought (starts at 1)"),
    totalThoughts: z
      .number()
      .int()
      .min(1)
      .describe(
        "Estimated total thoughts needed — can increase as complexity is discovered",
      ),
    nextThoughtNeeded: z
      .boolean()
      .describe(
        "Whether another thought step is needed after this one to complete the analysis",
      ),
    isRevision: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether this thought revises a previous thought"),
    revisesThought: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("If isRevision is true, the thought number being revised"),
    branchFromThought: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        "If branching, the thought number to branch from for alternative analysis",
      ),
    branchId: z
      .string()
      .optional()
      .describe(
        "Identifier for this branch of thinking (e.g., 'security-analysis', 'perf-alternative')",
      ),
  },
  async ({
    thought,
    thoughtNumber,
    totalThoughts,
    nextThoughtNeeded,
    isRevision,
    revisesThought,
    branchFromThought,
    branchId,
  }) => {
    try {
      const entry: ThoughtEntry = {
        thought,
        thoughtNumber,
        totalThoughts,
        isRevision: isRevision || false,
        revisesThought: revisesThought ?? null,
        branchFromThought: branchFromThought ?? null,
        branchId: branchId ?? null,
        needsMoreThoughts: nextThoughtNeeded,
      };

      const result = processThought(entry);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);
