import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const graphPath = resolve("flowgraph.dot");
const dotText = readFileSync(graphPath, "utf8");

function parseDotGraph(text) {
  const nodes = new Map();
  const edges = [];
  const nodePattern = /^\s*([A-Za-z_][\w]*)\s+\[label="([^"]*)"\];\s*$/gm;
  const edgePattern =
    /^\s*([A-Za-z_][\w]*)\s*->\s*([A-Za-z_][\w]*)(?:\s*\[\s*label\s*=\s*"([^"]*)"\s*\])?;\s*$/gm;

  for (const match of text.matchAll(nodePattern)) {
    nodes.set(match[1], {
      id: match[1],
      label: match[2],
      outgoing: [],
    });
  }

  for (const match of text.matchAll(edgePattern)) {
    edges.push({
      source: match[1],
      target: match[2],
      label: match[3] ? match[3].toLowerCase() : "",
    });
  }

  for (const edge of edges) {
    nodes.get(edge.source)?.outgoing.push(edge);
  }

  return { nodes, edges };
}

function assertGraph(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findReachableNodeIds(graph) {
  const reachable = new Set();
  const queue = ["start"];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (reachable.has(nodeId)) {
      continue;
    }

    reachable.add(nodeId);
    const node = graph.nodes.get(nodeId);
    for (const edge of node?.outgoing ?? []) {
      queue.push(edge.target);
    }
  }

  return reachable;
}

function validateGraph(graph) {
  assertGraph(graph.nodes.has("start"), "Missing start node.");
  assertGraph(graph.nodes.has("end"), "Missing end node.");

  for (const edge of graph.edges) {
    assertGraph(graph.nodes.has(edge.source), `Unknown edge source: ${edge.source}.`);
    assertGraph(graph.nodes.has(edge.target), `Unknown edge target: ${edge.target}.`);
  }

  const reachable = findReachableNodeIds(graph);
  for (const nodeId of graph.nodes.keys()) {
    assertGraph(reachable.has(nodeId), `Unreachable node: ${nodeId}.`);
  }
  assertGraph(reachable.has("end"), "End node is not reachable.");

  for (const node of graph.nodes.values()) {
    if (node.id === "end") {
      assertGraph(node.outgoing.length === 0, "End node must not have outgoing edges.");
      continue;
    }

    const labels = node.outgoing.map((edge) => edge.label).filter(Boolean);
    if (node.id.startsWith("d")) {
      const sortedLabels = [...labels].sort();
      assertGraph(
        node.outgoing.length === 2 && sortedLabels.join(",") === "no,yes",
        `Decision node ${node.id} must have exactly yes and no paths.`,
      );
    } else {
      assertGraph(node.outgoing.length === 1, `Step node ${node.id} must have exactly one path.`);
      assertGraph(labels.length === 0, `Step node ${node.id} must not have labeled paths.`);
    }
  }
}

const graph = parseDotGraph(dotText);
validateGraph(graph);

console.log(
  `Graph check passed: ${graph.nodes.size} nodes, ${graph.edges.length} edges, one reachable start-to-end flow.`,
);
