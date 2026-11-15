import type { ToolDef } from "./types.js";

export interface FederatedServer {
  name: string;
  url: string;
  tools: ToolDef[];
}

export function namespaceTools(server: FederatedServer): ToolDef[] {
  return server.tools.map((tool) => ({
    ...tool,
    name: `${server.name}_${tool.name}`,
  }));
}

export function mergeServers(
  servers: FederatedServer[]
): { tools: ToolDef[]; conflicts: string[] } {
  const tools: ToolDef[] = [];
  const seen = new Map<string, number>();
  const conflicts = new Set<string>();

  servers.forEach((server, serverIndex) => {
    const namespaced = namespaceTools(server);
    for (const tool of namespaced) {
      tools.push(tool);
      const previous = seen.get(tool.name);
      if (previous !== undefined && previous !== serverIndex) {
        conflicts.add(tool.name);
      } else if (previous === undefined) {
        seen.set(tool.name, serverIndex);
      }
    }
  });

  return { tools, conflicts: [...conflicts] };
}

export function findTool(
  servers: FederatedServer[],
  name: string
): { server: FederatedServer; tool: ToolDef } | undefined {
  for (const server of servers) {
    for (const tool of server.tools) {
      if (tool.name === name || `${server.name}_${tool.name}` === name) {
        return { server, tool };
      }
    }
  }
  return undefined;
}
