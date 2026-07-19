#!/usr/bin/env node
'use strict';

const fs = require('fs');

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error('Usage: node ua-tour-analyze.js <input.json> <output.json>');
  process.exit(1);
}

const ENTRY_FILENAMES = new Set([
  'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
  'server.ts', 'server.js', 'mod.rs', 'main.go', 'main.py', 'main.rs',
  'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'run.py', '__main__.py',
  'Application.java', 'Main.java', 'Program.cs', 'config.ru', 'index.php',
  'App.swift', 'Application.kt', 'main.cpp', 'main.c', 'main.jsx',
]);

function isCodeFile(node) {
  return node.type === 'file';
}

function depthFromRoot(filePath) {
  if (!filePath) return 99;
  const parts = filePath.split('/').filter(Boolean);
  return parts.length <= 1 ? 0 : parts.length <= 2 ? 1 : 2;
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read input:', err.message);
    process.exit(1);
  }

  const { nodes = [], edges = [], layers = [] } = data;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const fanIn = new Map(nodes.map((n) => [n.id, 0]));
  const fanOut = new Map(nodes.map((n) => [n.id, 0]));

  for (const edge of edges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      fanIn.set(edge.target, (fanIn.get(edge.target) || 0) + 1);
      fanOut.set(edge.source, (fanOut.get(edge.source) || 0) + 1);
    }
  }

  const fanInRanking = [...fanIn.entries()]
    .map(([id, fanInCount]) => ({
      id,
      fanIn: fanInCount,
      name: nodeMap.get(id)?.name || id,
    }))
    .sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id))
    .slice(0, 20);

  const fanOutRanking = [...fanOut.entries()]
    .map(([id, fanOutCount]) => ({
      id,
      fanOut: fanOutCount,
      name: nodeMap.get(id)?.name || id,
    }))
    .sort((a, b) => b.fanOut - a.fanOut || a.id.localeCompare(b.id))
    .slice(0, 20);

  const fanOutValues = [...fanOut.values()].sort((a, b) => a - b);
  const fanInValues = [...fanIn.values()].sort((a, b) => a - b);
  const top10FanOutThreshold =
    fanOutValues[Math.floor(fanOutValues.length * 0.9)] ?? 0;
  const bottom25FanInThreshold =
    fanInValues[Math.floor(fanInValues.length * 0.25)] ?? 0;

  const entryPointCandidates = nodes
    .map((node) => {
      let score = 0;
      const fi = fanIn.get(node.id) || 0;
      const fo = fanOut.get(node.id) || 0;

      if (node.type === 'document') {
        if (node.name === 'README.md' && depthFromRoot(node.filePath) === 0) score += 5;
        else if (node.name?.endsWith('.md') && depthFromRoot(node.filePath) === 0) score += 2;
      }

      if (isCodeFile(node)) {
        if (ENTRY_FILENAMES.has(node.name)) score += 3;
        const d = depthFromRoot(node.filePath);
        if (d <= 1) score += 1;
        if (fo >= top10FanOutThreshold) score += 1;
        if (fi <= bottom25FanInThreshold) score += 1;
      }

      return {
        id: node.id,
        score,
        name: node.name,
        summary: node.summary || '',
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5);

  const forwardEdgeTypes = new Set(['imports', 'calls']);
  const adjacency = new Map();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (forwardEdgeTypes.has(edge.type) && adjacency.has(edge.source)) {
      adjacency.get(edge.source).push(edge.target);
    }
  }

  const topCodeEntry = entryPointCandidates.find((c) => {
    const n = nodeMap.get(c.id);
    return n && isCodeFile(n);
  });

  const bfsStart = topCodeEntry?.id || entryPointCandidates[0]?.id || nodes[0]?.id;

  const order = [];
  const depthMap = {};
  const byDepth = {};
  const visited = new Set();

  if (bfsStart) {
    const queue = [{ id: bfsStart, depth: 0 }];
    visited.add(bfsStart);

    while (queue.length) {
      const { id, depth } = queue.shift();
      order.push(id);
      depthMap[id] = depth;
      const key = String(depth);
      if (!byDepth[key]) byDepth[key] = [];
      byDepth[key].push(id);

      for (const next of adjacency.get(id) || []) {
        if (!visited.has(next) && nodeMap.has(next)) {
          visited.add(next);
          queue.push({ id: next, depth: depth + 1 });
        }
      }
    }
  }

  const nonCodeFiles = {
    documentation: nodes
      .filter((n) => n.type === 'document')
      .map(({ id, name, type, summary }) => ({ id, name, type, summary })),
    infrastructure: nodes
      .filter((n) => ['service', 'pipeline', 'resource'].includes(n.type))
      .map(({ id, name, type, summary }) => ({ id, name, type, summary })),
    data: nodes
      .filter((n) => ['table', 'schema', 'endpoint'].includes(n.type))
      .map(({ id, name, type, summary }) => ({ id, name, type, summary })),
    config: nodes
      .filter((n) => n.type === 'config')
      .map(({ id, name, type, summary }) => ({ id, name, type, summary })),
  };

  const bidirectionalPairs = new Map();
  for (const edge of edges) {
    const rev = `${edge.target}\0${edge.source}`;
    const key = `${edge.source}\0${edge.target}`;
    if (bidirectionalPairs.has(rev)) {
      bidirectionalPairs.set(key, (bidirectionalPairs.get(rev) || 1) + 1);
    } else {
      bidirectionalPairs.set(key, bidirectionalPairs.get(key) || 0);
    }
  }

  const pairEdges = new Map();
  for (const edge of edges) {
    const a = edge.source;
    const b = edge.target;
    const pk = a < b ? `${a}\0${b}` : `${b}\0${a}`;
    if (!pairEdges.has(pk)) pairEdges.set(pk, { nodes: [a, b], edgeCount: 0 });
    pairEdges.get(pk).edgeCount += 1;
  }

  let clusters = [...pairEdges.values()]
    .filter((p) => p.edgeCount >= 2)
    .sort((a, b) => b.edgeCount - a.edgeCount)
    .slice(0, 10)
    .map((p) => ({ nodes: p.nodes, edgeCount: p.edgeCount }));

  const clusterMembers = new Map();
  for (const cluster of clusters) {
    for (const nid of cluster.nodes) {
      if (!clusterMembers.has(nid)) clusterMembers.set(nid, new Set());
      clusterMembers.get(nid).add(cluster);
    }
  }

  for (const edge of edges) {
    const srcClusters = clusterMembers.get(edge.source);
    const tgtClusters = clusterMembers.get(edge.target);
    if (!srcClusters || !tgtClusters) continue;
    for (const c of srcClusters) {
      if (tgtClusters.has(c) && c.nodes.length < 5) {
        const set = new Set(c.nodes);
        set.add(edge.source);
        set.add(edge.target);
        c.nodes = [...set];
      }
    }
  }

  clusters = clusters
    .filter((c) => c.nodes.length >= 2 && c.nodes.length <= 5)
    .slice(0, 10);

  const nodeSummaryIndex = {};
  for (const node of nodes) {
    nodeSummaryIndex[node.id] = {
      name: node.name,
      type: node.type,
      summary: node.summary || '',
    };
  }

  const layerList = layers.map(({ id, name, description }) => ({
    id,
    name,
    description,
  }));

  const result = {
    scriptCompleted: true,
    entryPointCandidates,
    fanInRanking,
    fanOutRanking,
    bfsTraversal: {
      startNode: bfsStart,
      order,
      depthMap,
      byDepth,
    },
    nonCodeFiles,
    clusters,
    layers: {
      count: layerList.length,
      list: layerList,
    },
    nodeSummaryIndex,
    totalNodes: nodes.length,
    totalEdges: edges.length,
  };

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.exit(0);
}

main();
