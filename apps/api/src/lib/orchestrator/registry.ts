import {
  ToolCallResult,
  ToolDefinition,
  ToolExecutionContext,
  ToolName,
  PRODUCTION_TOOL_NAMES,
} from "./types";
import {
  assertDriverToolDefinitionMetadata,
  driverToolDefinitionMetadata,
  getToolCapability,
} from "@/lib/orchestrator-tools/capability-catalog";

export type ToolRegistry = Map<ToolName, ToolDefinition>;

const baseObjectSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    projectId: {
      type: "string",
      description: "Project id the tool should operate on.",
    },
    revisionInstruction: {
      type: "string",
      description: "Optional instruction when retrying or revising a stage.",
    },
  },
} as const;

function failedUnimplemented(toolName: ToolName): ToolCallResult {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: `${toolName} is declared for the orchestrator vocabulary but is not wired to a live handler yet.`,
      recoverable: true,
      details: { toolName },
    },
  };
}

function defaultDefinition(name: ToolName): ToolDefinition {
  const metadata = getToolCapability(name);
  return {
    ...driverToolDefinitionMetadata(name),
    description: metadata.driverDescription,
    inputSchema: baseObjectSchema,
    outputSchema: {
      type: "object",
      additionalProperties: true,
    },
    requiredResourceIds: ["projectId"],
    estimateCostUsd: () => undefined,
    execute: async () => failedUnimplemented(name),
  };
}

// Driver stubs cover the flat PRODUCTION vocabulary only; root-only dispatch
// tools (delegate_*) live exclusively in the dormant creative-director
// registry and are never stubbed onto a flat surface.
export function createToolRegistry(
  overrides: Partial<Record<ToolName, Partial<ToolDefinition>>> = {}
): ToolRegistry {
  return new Map(
    PRODUCTION_TOOL_NAMES.map((name) => {
      const base = defaultDefinition(name);
      const override = overrides[name] ?? {};
      const definition = { ...base, ...override } satisfies ToolDefinition;
      assertDriverToolDefinitionMetadata(definition);
      return [name, definition];
    })
  );
}

export async function executeRegisteredTool(args: {
  registry: ToolRegistry;
  toolName: ToolName;
  input: unknown;
  context: ToolExecutionContext;
}): Promise<ToolCallResult> {
  const tool = args.registry.get(args.toolName);
  if (!tool) {
    return {
      status: "failed",
      error: {
        kind: "invalid_input",
        message: `Unknown orchestrator tool: ${args.toolName}`,
        recoverable: false,
        details: { toolName: args.toolName },
      },
    };
  }
  return tool.execute(args.input, args.context);
}
