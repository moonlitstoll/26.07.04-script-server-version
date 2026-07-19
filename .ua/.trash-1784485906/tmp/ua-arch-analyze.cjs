#!/usr/bin/env node
/**
 * Architecture structural analysis script for Understand Anything.
 * Usage: node ua-arch-analyze.js <input.json> <output.json>
 */
const fs = require('fs');
const path = require('path');

const DIR_PATTERNS = {
  routes: 'api', api: 'api', controllers: 'api', endpoints: 'api', handlers: 'api',
  services: 'service', core: 'service', lib: 'service', domain: 'service', logic: 'service',
  models: 'data', db: 'data', data: 'data', persistence: 'data', repository: 'data', entities: 'data',
  components: 'ui', views: 'ui', pages: 'ui', ui: 'ui', layouts: 'ui', screens: 'ui',
  middleware: 'middleware', plugins: 'middleware', interceptors: 'middleware', guards: 'middleware',
  utils: 'utility', helpers: 'utility', common: 'utility', shared: 'utility', tools: 'utility',
  config: 'config', constants: 'config', env: 'config', settings: 'config',
  __tests__: 'test', test: 'test', tests: 'test', spec: 'test', specs: 'test',
  types: 'types', interfaces: 'types', schemas: 'types', contracts: 'types', dtos: 'types',
  hooks: 'hooks',
  store: 'state', state: 'state', reducers: 'state', actions: 'state', slices: 'state',
  assets: 'assets', static: 'assets', public: 'assets',
  migrations: 'data',
  management: 'config', commands: 'config',
  templatetags: 'utility', signals: 'service', serializers: 'api',
  cmd: 'entry', internal: 'service', pkg: 'utility',
  composables: 'service', blueprints: 'api',
  mailers: 'service', jobs: 'service', channels: 'service',
  bin: 'entry',
  docs: 'documentation', documentation: 'documentation', wiki: 'documentation',
  deploy: 'infrastructure', deployment: 'infrastructure', infra: 'infrastructure', infrastructure: 'infrastructure',
  '.github': 'ci-cd', '.gitlab': 'ci-cd', '.circleci': 'ci-cd',
  k8s: 'infrastructure', kubernetes: 'infrastructure', helm: 'infrastructure', charts: 'infrastructure',
  terraform: 'infrastructure', tf: 'infrastructure', docker: 'infrastructure',
  sql: 'data', database: 'data', schema: 'data',
};

const TEST_PATTERNS = [
  /\.test\./, /\.spec\./, /^test_/, /_test\.(go|py|rb|php)$/, /Test\.(java|cs)$/, /_spec\.rb$/,
];

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    console.error('Usage: node ua-arch-analyze.js <input.json> <output.json>');
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error('Failed to read input:', e.message);
    process.exit(1);
  }

  const { fileNodes, importEdges, allEdges } = input;
  if (!fileNodes || !importEdges || !allEdges) {
    console.error('Input must contain fileNodes, importEdges, allEdges');
    process.exit(1);
  }

  const result = analyze(fileNodes, importEdges, allEdges);

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write output:', e.message);
    process.exit(1);
  }
}

function analyze(fileNodes, importEdges, allEdges) {
  const filePaths = fileNodes.map(n => n.filePath || '').filter(Boolean);
  const commonPrefix = computeCommonPrefix(filePaths);
  const directoryGroups = groupByDirectory(fileNodes, commonPrefix);
  const nodeTypeGroups = groupByType(fileNodes);

  const { adjacency, fanOut, fanIn } = buildAdjacency(importEdges);
  const fileToGroup = buildFileToGroupMap(fileNodes, directoryGroups);
  const interGroupImports = computeInterGroupImports(importEdges, fileToGroup);
  const intraGroupDensity = computeIntraGroupDensity(importEdges, fileToGroup, directoryGroups);
  const patternMatches = classifyGroups(directoryGroups, fileNodes);
  const crossCategoryEdges = computeCrossCategory(allEdges);
  const deploymentTopology = detectDeployment(fileNodes);
  const dataPipeline = detectDataPipeline(fileNodes);
  const docCoverage = computeDocCoverage(directoryGroups, fileNodes);
  const dependencyDirection = computeDependencyDirection(interGroupImports);

  const filesPerGroup = {};
  for (const [g, ids] of Object.entries(directoryGroups)) {
    filesPerGroup[g] = ids.length;
  }

  const nodeTypeCounts = {};
  for (const [t, ids] of Object.entries(nodeTypeGroups)) {
    nodeTypeCounts[t] = ids.length;
  }

  return {
    scriptCompleted: true,
    commonPrefix,
    directoryGroups,
    nodeTypeGroups,
    crossCategoryEdges,
    interGroupImports,
    intraGroupDensity,
    patternMatches,
    deploymentTopology,
    dataPipeline,
    docCoverage,
    dependencyDirection,
    fileStats: {
      totalFileNodes: fileNodes.length,
      filesPerGroup,
      nodeTypeCounts,
    },
    fileFanIn: fanIn,
    fileFanOut: fanOut,
  };
}

function computeCommonPrefix(paths) {
  if (paths.length === 0) return '';
  const split = paths.map(p => p.split('/'));
  const minLen = Math.min(...split.map(s => s.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = split[0][i];
    if (split.every(s => s[i] === seg)) common.push(seg);
    else break;
  }
  if (common.length === 0) return '';
  return common.join('/') + (common.length > 0 && paths.some(p => p.split('/').length > common.length) ? '/' : '');
}

function groupByDirectory(fileNodes, commonPrefix) {
  const prefix = commonPrefix.endsWith('/') ? commonPrefix : (commonPrefix ? commonPrefix + '/' : '');
  const groups = {};

  for (const node of fileNodes) {
    const fp = node.filePath || '';
    let rel = fp;
    if (prefix && fp.startsWith(prefix)) rel = fp.slice(prefix.length);
    else if (commonPrefix && fp.startsWith(commonPrefix)) rel = fp.slice(commonPrefix.length).replace(/^\//, '');

    const parts = rel.split('/').filter(Boolean);
    let groupKey;

    if (parts.length >= 2) {
      groupKey = parts[0] + '/' + parts[1];
    } else if (parts.length === 1) {
      groupKey = parts[0].includes('.') ? 'root' : parts[0];
    } else {
      groupKey = 'root';
    }

    // Flat root files grouped as root
    if (parts.length === 1 && parts[0].includes('.')) {
      const ext = path.extname(parts[0]);
      if (['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.html', '.css'].includes(ext)) {
        groupKey = 'root';
      }
    }

    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(node.id);
  }

  return groups;
}

function groupByType(fileNodes) {
  const groups = {};
  for (const node of fileNodes) {
    const t = node.type || 'file';
    if (!groups[t]) groups[t] = [];
    groups[t].push(node.id);
  }
  return groups;
}

function buildAdjacency(importEdges) {
  const adjacency = {};
  const fanOut = {};
  const fanIn = {};

  for (const edge of importEdges) {
    if (edge.type !== 'imports') continue;
    const { source, target } = edge;
    if (!adjacency[source]) adjacency[source] = new Set();
    adjacency[source].add(target);
    fanOut[source] = (fanOut[source] || 0) + 1;
    fanIn[target] = (fanIn[target] || 0) + 1;
  }

  const fanOutObj = {};
  const fanInObj = {};
  for (const [k, v] of Object.entries(fanOut)) fanOutObj[k] = v;
  for (const [k, v] of Object.entries(fanIn)) fanInObj[k] = v;

  return { adjacency, fanOut: fanOutObj, fanIn: fanInObj };
}

function buildFileToGroupMap(fileNodes, directoryGroups) {
  const map = {};
  for (const [group, ids] of Object.entries(directoryGroups)) {
    for (const id of ids) map[id] = group;
  }
  return map;
}

function computeInterGroupImports(importEdges, fileToGroup) {
  const matrix = {};
  for (const edge of importEdges) {
    if (edge.type !== 'imports') continue;
    const fromG = fileToGroup[edge.source];
    const toG = fileToGroup[edge.target];
    if (!fromG || !toG) continue;
    const key = `${fromG}->${toG}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  return Object.entries(matrix).map(([key, count]) => {
    const [from, to] = key.split('->');
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);
}

function computeIntraGroupDensity(importEdges, fileToGroup, directoryGroups) {
  const result = {};
  for (const group of Object.keys(directoryGroups)) {
    let internal = 0;
    let total = 0;
    for (const edge of importEdges) {
      if (edge.type !== 'imports') continue;
      const fromG = fileToGroup[edge.source];
      const toG = fileToGroup[edge.target];
      if (fromG === group || toG === group) {
        total++;
        if (fromG === group && toG === group) internal++;
      }
    }
    result[group] = {
      internalEdges: internal,
      totalEdges: total,
      density: total > 0 ? Math.round((internal / total) * 1000) / 1000 : 0,
    };
  }
  return result;
}

function classifyFilePattern(filePath, fileName) {
  for (const pat of TEST_PATTERNS) {
    if (pat.test(filePath) || pat.test(fileName)) return 'test';
  }
  if (filePath.endsWith('.d.ts')) return 'types';
  if (['index.ts', 'index.js', '__init__.py'].includes(fileName)) return 'entry';
  if (fileName === 'manage.py') return 'entry';
  if (['wsgi.py', 'asgi.py'].includes(fileName)) return 'config';
  if (['Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml', 'build.gradle', 'composer.json'].includes(fileName)) return 'config';
  if (fileName === 'Dockerfile' || /^docker-compose/.test(fileName)) return 'infrastructure';
  if (filePath.endsWith('.tf') || filePath.endsWith('.tfvars')) return 'infrastructure';
  if (filePath.includes('.github/workflows') || fileName === '.gitlab-ci.yml' || fileName === 'Jenkinsfile') return 'ci-cd';
  if (filePath.endsWith('.sql')) return 'data';
  if (/\.(graphql|gql|proto)$/.test(filePath)) return 'types';
  if (/\.(md|rst)$/.test(filePath)) return 'documentation';
  if (fileName === 'Makefile') return 'infrastructure';
  if (fileName === 'index.html') return 'entry';
  if (fileName === 'main.jsx' || fileName === 'main.tsx') return 'entry';
  return null;
}

function classifyGroups(directoryGroups, fileNodes) {
  const nodeById = Object.fromEntries(fileNodes.map(n => [n.id, n]));
  const matches = {};

  for (const group of Object.keys(directoryGroups)) {
    const seg = group.split('/')[0].toLowerCase();
    if (DIR_PATTERNS[seg]) {
      matches[group] = DIR_PATTERNS[seg];
      continue;
    }
    // Second segment for src/*
    const parts = group.split('/');
    if (parts.length >= 2 && DIR_PATTERNS[parts[1].toLowerCase()]) {
      matches[group] = DIR_PATTERNS[parts[1].toLowerCase()];
      continue;
    }
    // File-level patterns from first file in group
    const firstId = directoryGroups[group][0];
    const node = nodeById[firstId];
    if (node) {
      const fp = node.filePath || '';
      const filePat = classifyFilePattern(fp, node.name || path.basename(fp));
      if (filePat) {
        matches[group] = filePat;
        continue;
      }
    }
    matches[group] = 'unknown';
  }
  return matches;
}

function computeCrossCategory(allEdges) {
  const matrix = {};
  for (const edge of allEdges) {
    const srcType = edge.source.split(':')[0];
    const tgtType = edge.target.split(':')[0];
    const edgeType = edge.type || 'unknown';
    const key = `${srcType}->${tgtType}:${edgeType}`;
    matrix[key] = (matrix[key] || 0) + 1;
  }
  return Object.entries(matrix).map(([key, count]) => {
    const [types, edgeType] = key.split(':');
    const [fromType, toType] = types.split('->');
    return { fromType, toType, edgeType, count };
  }).sort((a, b) => b.count - a.count);
}

function detectDeployment(fileNodes) {
  const infraPatterns = [
    /^Dockerfile$/i, /^docker-compose/i, /\.tf$/, /vercel\.json$/, /netlify\.toml$/,
  ];
  const ciPatterns = [/\.github\/workflows/, /\.gitlab-ci\.yml$/, /^Jenkinsfile$/];
  const infraFiles = [];
  let hasDockerfile = false, hasCompose = false, hasK8s = false, hasTerraform = false, hasCI = false;

  for (const node of fileNodes) {
    const fp = node.filePath || node.name || '';
    if (/^Dockerfile$/i.test(path.basename(fp))) { hasDockerfile = true; infraFiles.push(fp); }
    if (/docker-compose/i.test(fp)) { hasCompose = true; infraFiles.push(fp); }
    if (/\.(yaml|yml)$/.test(fp) && /k8s|kubernetes|helm|charts/i.test(fp)) { hasK8s = true; infraFiles.push(fp); }
    if (/\.tf$/.test(fp)) { hasTerraform = true; infraFiles.push(fp); }
    if (ciPatterns.some(p => p.test(fp))) { hasCI = true; infraFiles.push(fp); }
    if (fp === 'vercel.json' || node.id === 'config:vercel.json') {
      infraFiles.push(fp);
    }
  }

  return { hasDockerfile, hasCompose, hasK8s, hasTerraform, hasCI, infraFiles: [...new Set(infraFiles)] };
}

function detectDataPipeline(fileNodes) {
  const schemaFiles = [], migrationFiles = [], dataModelFiles = [], apiHandlerFiles = [];
  for (const node of fileNodes) {
    const fp = node.filePath || '';
    if (/\.(sql|graphql|gql|proto|prisma)$/.test(fp)) schemaFiles.push(fp);
    if (/migrations?\//i.test(fp)) migrationFiles.push(fp);
    if (/models?\//i.test(fp) || node.tags?.includes('data-model')) {
      if (node.type === 'file') dataModelFiles.push(fp);
    }
    if (node.tags?.includes('api-handler') || fp.startsWith('api/')) apiHandlerFiles.push(fp);
  }
  return { schemaFiles, migrationFiles, dataModelFiles, apiHandlerFiles };
}

function computeDocCoverage(directoryGroups, fileNodes) {
  const docGroups = new Set();
  const allGroups = Object.keys(directoryGroups);
  for (const node of fileNodes) {
    if (node.type === 'document' || /\.(md|rst)$/.test(node.filePath || '')) {
      for (const [group, ids] of Object.entries(directoryGroups)) {
        if (ids.includes(node.id)) docGroups.add(group);
      }
    }
  }
  // Also mark root if README exists
  if (directoryGroups.root?.some(id => id.includes('README'))) docGroups.add('root');

  const undocumentedGroups = allGroups.filter(g => !docGroups.has(g));
  return {
    groupsWithDocs: docGroups.size,
    totalGroups: allGroups.length,
    coverageRatio: allGroups.length > 0 ? Math.round((docGroups.size / allGroups.length) * 1000) / 1000 : 0,
    undocumentedGroups,
  };
}

function computeDependencyDirection(interGroupImports) {
  const pairMap = {};
  for (const { from, to, count } of interGroupImports) {
    const key = [from, to].sort().join('|');
    if (!pairMap[key]) pairMap[key] = {};
    pairMap[key][from] = (pairMap[key][from] || 0) + count;
  }
  const directions = [];
  for (const [key, counts] of Object.entries(pairMap)) {
    const [a, b] = key.split('|');
    const aToB = counts[a] || 0;
    const bToA = counts[b] || 0;
    if (aToB > bToA) directions.push({ dependent: a, dependsOn: b, delta: aToB - bToA });
    else if (bToA > aToB) directions.push({ dependent: b, dependsOn: a, delta: bToA - aToB });
  }
  return directions.sort((a, b) => b.delta - a.delta);
}

main();
