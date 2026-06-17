const FLOWGRAPH_URL = "flowgraph.dot";

const elements = {
  stepKind: document.querySelector("#step-kind"),
  progressLabel: document.querySelector("#progress-label"),
  stepTitle: document.querySelector("#step-title"),
  choicePanel: document.querySelector("#choice-panel"),
  backButton: document.querySelector("#back-button"),
  restartButton: document.querySelector("#restart-button"),
  historyList: document.querySelector("#history-list"),
};

const state = {
  graph: null,
  currentNodeId: "start",
  history: [],
};

function parseDotGraph(dotText) {
  const nodes = new Map();
  const edges = [];
  const nodePattern = /^\s*([A-Za-z_][\w]*)\s+\[label="([^"]*)"\];\s*$/gm;
  const edgePattern =
    /^\s*([A-Za-z_][\w]*)\s*->\s*([A-Za-z_][\w]*)(?:\s*\[\s*label\s*=\s*"([^"]*)"\s*\])?;\s*$/gm;

  for (const match of dotText.matchAll(nodePattern)) {
    nodes.set(match[1], {
      id: match[1],
      label: match[2],
      outgoing: [],
    });
  }

  for (const match of dotText.matchAll(edgePattern)) {
    const edge = {
      source: match[1],
      target: match[2],
      label: match[3] ? match[3].toLowerCase() : "",
    };
    edges.push(edge);
  }

  for (const edge of edges) {
    const source = nodes.get(edge.source);
    if (source) {
      source.outgoing.push(edge);
    }
  }

  return { nodes, edges };
}

function getNodeKind(node) {
  if (node.id === "end") {
    return "Complete";
  }

  const labels = node.outgoing.map((edge) => edge.label).filter(Boolean);
  if (labels.includes("yes") || labels.includes("no")) {
    return "Decision";
  }

  if (node.id === "start") {
    return "Start";
  }

  return "Step";
}

function getPrimaryActionLabel(node) {
  if (node.id === "start") {
    return "Begin";
  }

  return node.outgoing[0]?.target === "end" ? "Finish" : "Continue";
}

function formatChoiceLabel(edge, sourceNode) {
  if (edge.label) {
    return edge.label;
  }

  return getPrimaryActionLabel(sourceNode).toLowerCase();
}

function setCurrentNode(nodeId) {
  state.currentNodeId = nodeId;
  render();
}

function followEdge(edge) {
  const sourceNode = state.graph.nodes.get(edge.source);
  const targetNode = state.graph.nodes.get(edge.target);
  state.history.push({
    sourceId: edge.source,
    sourceLabel: sourceNode.label,
    targetId: edge.target,
    targetLabel: targetNode.label,
    choice: formatChoiceLabel(edge, sourceNode),
  });
  setCurrentNode(edge.target);
}

function restart() {
  state.currentNodeId = "start";
  state.history = [];
  render();
}

function back() {
  const lastEntry = state.history.pop();
  if (lastEntry) {
    setCurrentNode(lastEntry.sourceId);
  }
}

function countDecisions() {
  return state.history.filter((entry) => entry.choice === "yes" || entry.choice === "no").length;
}

function renderChoices(node) {
  elements.choicePanel.innerHTML = "";
  elements.choicePanel.classList.toggle("single-choice", node.outgoing.length <= 1 || node.id === "end");

  if (node.id === "end") {
    const summary = document.createElement("ol");
    summary.className = "summary-list";

    const decisionEntries = state.history.filter(
      (entry) => entry.choice === "yes" || entry.choice === "no",
    );

    for (const entry of decisionEntries) {
      const item = document.createElement("li");
      const answer = document.createElement("span");
      answer.className = entry.choice;
      answer.textContent = entry.choice.toUpperCase();

      const text = document.createElement("strong");
      text.textContent = entry.sourceLabel;

      item.append(answer, text);
      summary.append(item);
    }

    elements.choicePanel.append(summary);
    return;
  }

  const sortedEdges = [...node.outgoing].sort((first, second) => {
    const order = { yes: 0, no: 1 };
    return (order[first.label] ?? 2) - (order[second.label] ?? 2);
  });

  for (const edge of sortedEdges) {
    const button = document.createElement("button");
    const choiceLabel = edge.label || getPrimaryActionLabel(node).toLowerCase();
    button.className = "choice-button";
    button.type = "button";
    button.dataset.choice = choiceLabel;
    button.textContent = edge.label ? edge.label.toUpperCase() : getPrimaryActionLabel(node);
    button.addEventListener("click", () => followEdge(edge));
    elements.choicePanel.append(button);
  }
}

function renderHistory() {
  elements.historyList.innerHTML = "";

  if (state.history.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No selections recorded.";
    elements.historyList.append(item);
    return;
  }

  for (const entry of state.history) {
    const item = document.createElement("li");
    const source = document.createElement("strong");
    source.textContent = entry.sourceLabel;
    item.append(source, ` - ${entry.choice.toUpperCase()} - ${entry.targetLabel}`);
    elements.historyList.append(item);
  }
}

function render() {
  if (!state.graph) {
    return;
  }

  const node = state.graph.nodes.get(state.currentNodeId);
  elements.stepKind.textContent = getNodeKind(node);
  elements.progressLabel.textContent = `${countDecisions()} decisions`;
  elements.stepTitle.textContent = node.label;
  elements.backButton.disabled = state.history.length === 0;
  renderChoices(node);
  renderHistory();
}

function renderError(error) {
  elements.stepKind.textContent = "Error";
  elements.progressLabel.textContent = "0 decisions";
  elements.stepTitle.classList.add("error-state");
  elements.stepTitle.textContent = "Flow graph could not be loaded";
  elements.choicePanel.innerHTML = "";

  const message = document.createElement("p");
  message.className = "error-state";
  message.textContent = `${error.message}. Static HTTP serving is required for local testing.`;
  elements.choicePanel.append(message);

  elements.backButton.disabled = true;
}

async function loadGraph() {
  try {
    const response = await fetch(FLOWGRAPH_URL);
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const dotText = await response.text();
    state.graph = parseDotGraph(dotText);
    render();
  } catch (error) {
    renderError(error);
  }
}

elements.backButton.addEventListener("click", back);
elements.restartButton.addEventListener("click", restart);

loadGraph();
