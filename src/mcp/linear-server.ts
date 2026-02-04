#!/usr/bin/env node
// Linear MCP Server - Provides Linear issue management functionality
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

if (!LINEAR_API_KEY) {
  console.error("Error: LINEAR_API_KEY environment variable is required");
  process.exit(1);
}

const LINEAR_API_URL = "https://api.linear.app/graphql";

interface LinearResponse {
  data?: Record<string, any>;
  errors?: Array<{ message: string }>;
}

async function linearRequest(
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: LINEAR_API_KEY as string,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `Linear API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as LinearResponse;
  if (data.errors) {
    throw new Error(`Linear GraphQL error: ${JSON.stringify(data.errors)}`);
  }

  return data.data as Record<string, unknown>;
}

const server = new McpServer({
  name: "Linear Server",
  version: "0.0.1",
});

// Get teams
server.tool(
  "get_teams",
  "Get all Linear teams available to the authenticated user",
  {},
  async () => {
    try {
      const query = `
        query {
          teams {
            nodes {
              id
              name
              key
            }
          }
        }
      `;
      const result = await linearRequest(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.teams.nodes, null, 2),
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

// Get workflow states for a team
server.tool(
  "get_workflow_states",
  "Get workflow states (statuses) for a Linear team",
  {
    team_id: z.string().describe("The team ID to get workflow states for"),
  },
  async ({ team_id }) => {
    try {
      const query = `
        query($teamId: String!) {
          team(id: $teamId) {
            states {
              nodes {
                id
                name
                type
                position
              }
            }
          }
        }
      `;
      const result = await linearRequest(query, { teamId: team_id });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.team.states.nodes, null, 2),
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

// Get labels for a team
server.tool(
  "get_labels",
  "Get labels available for a Linear team",
  {
    team_id: z
      .string()
      .optional()
      .describe("Optional team ID to filter labels"),
  },
  async ({ team_id }) => {
    try {
      const query = team_id
        ? `
          query($teamId: String!) {
            team(id: $teamId) {
              labels {
                nodes {
                  id
                  name
                  color
                }
              }
            }
          }
        `
        : `
          query {
            issueLabels {
              nodes {
                id
                name
                color
              }
            }
          }
        `;
      const result = await linearRequest(
        query,
        team_id ? { teamId: team_id } : undefined,
      );
      const labels = team_id
        ? result.team.labels.nodes
        : result.issueLabels.nodes;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(labels, null, 2),
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

// Create issue
server.tool(
  "create_issue",
  "Create a new Linear issue",
  {
    title: z.string().describe("The title of the issue"),
    description: z
      .string()
      .optional()
      .describe("The description/body of the issue (markdown supported)"),
    team_id: z.string().describe("The team ID to create the issue in"),
    priority: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("Priority: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low"),
    label_ids: z
      .array(z.string())
      .optional()
      .describe("Array of label IDs to attach"),
    assignee_id: z
      .string()
      .optional()
      .describe("User ID to assign the issue to"),
    state_id: z.string().optional().describe("Workflow state ID for the issue"),
  },
  async ({
    title,
    description,
    team_id,
    priority,
    label_ids,
    assignee_id,
    state_id,
  }) => {
    try {
      const query = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              state {
                name
              }
              priority
            }
          }
        }
      `;

      const input: Record<string, unknown> = {
        title,
        teamId: team_id,
      };

      if (description) input.description = description;
      if (priority !== undefined) input.priority = priority;
      if (label_ids && label_ids.length > 0) input.labelIds = label_ids;
      if (assignee_id) input.assigneeId = assignee_id;
      if (state_id) input.stateId = state_id;

      const result = await linearRequest(query, { input });

      if (!result.issueCreate.success) {
        throw new Error("Failed to create issue");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                issue: result.issueCreate.issue,
                message: `Created issue ${result.issueCreate.issue.identifier}: ${result.issueCreate.issue.url}`,
              },
              null,
              2,
            ),
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

// Update issue
server.tool(
  "update_issue",
  "Update an existing Linear issue",
  {
    issue_id: z.string().describe("The issue ID to update"),
    title: z.string().optional().describe("New title for the issue"),
    description: z
      .string()
      .optional()
      .describe("New description for the issue"),
    priority: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("Priority: 0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low"),
    state_id: z.string().optional().describe("New workflow state ID"),
    assignee_id: z.string().optional().describe("New assignee user ID"),
    label_ids: z
      .array(z.string())
      .optional()
      .describe("New label IDs (replaces existing)"),
  },
  async ({
    issue_id,
    title,
    description,
    priority,
    state_id,
    assignee_id,
    label_ids,
  }) => {
    try {
      const query = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              state {
                name
              }
              priority
            }
          }
        }
      `;

      const input: Record<string, unknown> = {};
      if (title) input.title = title;
      if (description) input.description = description;
      if (priority !== undefined) input.priority = priority;
      if (state_id) input.stateId = state_id;
      if (assignee_id) input.assigneeId = assignee_id;
      if (label_ids) input.labelIds = label_ids;

      const result = await linearRequest(query, { id: issue_id, input });

      if (!result.issueUpdate.success) {
        throw new Error("Failed to update issue");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                issue: result.issueUpdate.issue,
              },
              null,
              2,
            ),
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

// Search issues
server.tool(
  "search_issues",
  "Search for Linear issues",
  {
    query: z.string().optional().describe("Search query string"),
    team_id: z.string().optional().describe("Filter by team ID"),
    state_name: z
      .string()
      .optional()
      .describe("Filter by state name (e.g., 'In Progress', 'Done')"),
    assignee_id: z.string().optional().describe("Filter by assignee user ID"),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum number of results (default 10, max 50)"),
  },
  async ({ query, team_id, state_name, assignee_id, limit }) => {
    try {
      const filters: string[] = [];
      if (team_id) filters.push(`team: { id: { eq: "${team_id}" } }`);
      if (state_name) filters.push(`state: { name: { eq: "${state_name}" } }`);
      if (assignee_id)
        filters.push(`assignee: { id: { eq: "${assignee_id}" } }`);

      const filterString =
        filters.length > 0 ? `filter: { ${filters.join(", ")} }` : "";

      const gqlQuery = `
        query($first: Int${query ? ", $query: String" : ""}) {
          issues(first: $first${query ? ", filter: { searchableContent: { contains: $query } }" : filterString ? `, ${filterString}` : ""}) {
            nodes {
              id
              identifier
              title
              url
              state {
                name
              }
              priority
              assignee {
                name
              }
              team {
                name
                key
              }
              createdAt
              updatedAt
            }
          }
        }
      `;

      const variables: Record<string, unknown> = { first: limit || 10 };
      if (query) variables.query = query;

      const result = await linearRequest(gqlQuery, variables);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.issues.nodes, null, 2),
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

// Get issue by ID or identifier
server.tool(
  "get_issue",
  "Get a specific Linear issue by ID or identifier (e.g., 'ENG-123')",
  {
    issue_id: z
      .string()
      .describe("The issue ID or identifier (e.g., 'ENG-123')"),
  },
  async ({ issue_id }) => {
    try {
      // Try to detect if it's an identifier (contains letters and dash) or UUID
      const isIdentifier = /^[A-Z]+-\d+$/i.test(issue_id);

      const query = isIdentifier
        ? `
          query($identifier: String!) {
            issue(id: $identifier) {
              id
              identifier
              title
              description
              url
              state {
                id
                name
              }
              priority
              assignee {
                id
                name
              }
              team {
                id
                name
                key
              }
              labels {
                nodes {
                  id
                  name
                }
              }
              comments {
                nodes {
                  body
                  user {
                    name
                  }
                  createdAt
                }
              }
              createdAt
              updatedAt
            }
          }
        `
        : `
          query($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              url
              state {
                id
                name
              }
              priority
              assignee {
                id
                name
              }
              team {
                id
                name
                key
              }
              labels {
                nodes {
                  id
                  name
                }
              }
              comments {
                nodes {
                  body
                  user {
                    name
                  }
                  createdAt
                }
              }
              createdAt
              updatedAt
            }
          }
        `;

      const result = await linearRequest(
        query,
        isIdentifier ? { identifier: issue_id } : { id: issue_id },
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.issue, null, 2),
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

// Add comment to issue
server.tool(
  "add_comment",
  "Add a comment to a Linear issue",
  {
    issue_id: z.string().describe("The issue ID to comment on"),
    body: z.string().describe("The comment body (markdown supported)"),
  },
  async ({ issue_id, body }) => {
    try {
      const query = `
        mutation CreateComment($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            success
            comment {
              id
              body
              createdAt
            }
          }
        }
      `;

      const result = await linearRequest(query, {
        input: {
          issueId: issue_id,
          body,
        },
      });

      if (!result.commentCreate.success) {
        throw new Error("Failed to create comment");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                comment: result.commentCreate.comment,
              },
              null,
              2,
            ),
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

// Get current user
server.tool(
  "get_viewer",
  "Get information about the authenticated Linear user",
  {},
  async () => {
    try {
      const query = `
        query {
          viewer {
            id
            name
            email
            admin
            teams {
              nodes {
                id
                name
                key
              }
            }
          }
        }
      `;
      const result = await linearRequest(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.viewer, null, 2),
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
