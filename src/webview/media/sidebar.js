// Flutter Explorer Sidebar JavaScript
// Handles tab switching, search, widget tree, dependency graph, and pubspec rendering

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();
  window.vscodeApi = vscode;
  let currentFilter = 'all';
  let searchTimeout = null;

  // ─── Tab Switching ─────────────────────────────────────

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const targetTab = this.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (tc) { tc.classList.remove('active'); });
      this.classList.add('active');
      const targetEl = document.getElementById('tab-' + targetTab);
      if (targetEl) { targetEl.classList.add('active'); }

      // Load data for tab
      if (targetTab === 'tree') { vscode.postMessage({ command: 'getWidgetTree' }); }
      else if (targetTab === 'graph') { vscode.postMessage({ command: 'getDependencyGraph' }); }
      else if (targetTab === 'pubspec') { vscode.postMessage({ command: 'getPubspec' }); }
      else if (targetTab === 'analysis') { vscode.postMessage({ command: 'getAnalysis' }); }
      else if (targetTab === 'libraries') { vscode.postMessage({ command: 'getPackages' }); }
    });
  });

  // ─── Search ────────────────────────────────────────────

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      if (searchTimeout) { clearTimeout(searchTimeout); }
      searchTimeout = setTimeout(function () {
        const query = searchInput.value;
        const filter = currentFilter === 'all' ? undefined : currentFilter;
        vscode.postMessage({ command: 'search', query: query, filter: filter });
      }, 200);
    });
  }

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      currentFilter = this.getAttribute('data-filter');
      // Re-trigger search
      if (searchInput && searchInput.value) {
        const filter = currentFilter === 'all' ? undefined : currentFilter;
        vscode.postMessage({ command: 'search', query: searchInput.value, filter: filter });
      }
    });
  });

  // ─── Refresh Buttons ──────────────────────────────────

  const refreshTree = document.getElementById('refreshTree');
  if (refreshTree) {
    refreshTree.addEventListener('click', function () {
      vscode.postMessage({ command: 'getWidgetTree' });
    });
  }

  const refreshGraph = document.getElementById('refreshGraph');
  if (refreshGraph) {
    refreshGraph.addEventListener('click', function () {
      vscode.postMessage({ command: 'getDependencyGraph' });
    });
  }

  const openInteractiveGraph = document.getElementById('openInteractiveGraph');
  if (openInteractiveGraph) {
    openInteractiveGraph.addEventListener('click', function () {
      vscode.postMessage({ command: 'openGraph' });
    });
  }

  const refreshPubspec = document.getElementById('refreshPubspec');
  if (refreshPubspec) {
    refreshPubspec.addEventListener('click', function () {
      vscode.postMessage({ command: 'getPubspec' });
    });
  }

  const refreshAnalysis = document.getElementById('refreshAnalysis');
  if (refreshAnalysis) {
    refreshAnalysis.addEventListener('click', function () {
      vscode.postMessage({ command: 'getAnalysis' });
    });
  }

  const compareParsers = document.getElementById('compareParsers');
  if (compareParsers) {
    compareParsers.addEventListener('click', function () {
      vscode.postMessage({ command: 'compareParsers' });
    });
  }

  const refreshLibraries = document.getElementById('refreshLibraries');
  if (refreshLibraries) {
    refreshLibraries.addEventListener('click', function () {
      vscode.postMessage({ command: 'getPackages' });
    });
  }

  // ─── Message Handler ──────────────────────────────────

  window.addEventListener('message', function (event) {
    const message = event.data;
    switch (message.command) {
      case 'searchResults':
        renderSearchResults(message.data);
        break;
      case 'widgetTree':
        renderWidgetTree(message.data);
        break;
      case 'dependencyGraph':
        renderDependencyGraph(message.data);
        break;
      case 'pubspecData':
        renderPubspec(message.data);
        break;
      case 'analysisData':
        renderAnalysis(message.data);
        break;
      case 'stats':
        renderStats(message.data);
        break;
      case 'packagesData':
        renderPackages(message.data);
        break;
    }
  });

  // ─── Render Functions ─────────────────────────────────

  function renderSearchResults(results) {
    const container = document.getElementById('searchResults');
    if (!container) { return; }

    if (!results || results.length === 0) {
      const q = searchInput ? searchInput.value : '';
      container.innerHTML = q
        ? '<div class="no-results">No results found for "' + escapeHtml(q) + '"</div>'
        : '<div class="no-results">Start typing to search...</div>';
      return;
    }

    let html = '';
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      html += '<div class="result-item" data-file="' + escapeHtml(r.file) + '" data-line="' + r.line + '">';
      html += '<span class="result-icon">' + r.icon + '</span>';
      html += '<div class="result-info">';
      html += '<div class="result-name' + (r.isPrivate ? ' private' : '') + '">' + escapeHtml(r.name) + '</div>';
      html += '<div class="result-detail">' + escapeHtml(r.relativePath) + ':' + r.line;
      if (r.subType && r.subType !== r.name) { html += ' — ' + escapeHtml(r.subType); }
      html += '</div></div>';
      if (r.usageCount !== undefined && r.usageCount > 0) {
        html += '<span class="result-usage-badge" title="Usage Count">↺ ' + r.usageCount + '</span>';
      }
      html += '<span class="result-badge badge-' + r.type + '">' + r.type + '</span>';
      html += '<button class="copy-btn icon-btn" title="Copy symbol name" data-copy="' + escapeHtml(r.name) + '" style="margin-left: 4px; padding: 2px 4px; font-size: 10px;">📋</button>';
      html += '</div>';
    }
    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('.result-item').forEach(function (item) {
      item.addEventListener('click', function () {
        const file = this.getAttribute('data-file');
        const line = parseInt(this.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'openFile', file: file, line: line });
      });
    });

    container.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const text = this.getAttribute('data-copy');
        copyToClipboard(text, this);
      });
    });
  }

  function renderWidgetTree(data) {
    const fileNameEl = document.getElementById('treeFileName');
    const treeView = document.getElementById('treeView');
    if (!fileNameEl || !treeView) return;

    if (!data || !data.fileName) {
      fileNameEl.textContent = 'No Dart file open';
      treeView.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🌳</div><div class="empty-state-text">Open a Dart file to see its widget tree</div></div>';
      return;
    }

    fileNameEl.textContent = data.fileName;
    let html = '';

    // Helper to render sections
    function renderSection(title, items, iconText, badgeClass) {
      if (!items || items.length === 0) return '';
      let sectionHtml = '<div class="class-list"><div style="font-size: 11px; color: #888; font-weight: bold; margin-bottom: 4px; text-transform: uppercase;">' + title + '</div>';
      for (const item of items) {
        let opacityStyle = item.isPrivate ? 'opacity: 0.7; font-style: italic;' : '';
        let typeName = item.type || iconText;
        sectionHtml += `<div class="class-item" data-line="${item.line}">
          <span class="class-type-badge ${badgeClass}">${typeName}</span>
          <span style="${opacityStyle}">${escapeHtml(item.name)}</span>
        </div>`;
      }
      sectionHtml += '</div>';
      return sectionHtml;
    }

    html += renderSection('Classes', data.classNames, 'class', 'badge-class');
    html += renderSection('Mixins', data.mixins, 'mixin', 'badge-mixin');
    html += renderSection('Extensions', data.extensions, 'ext', 'badge-extension');
    html += renderSection('Enums', data.enums, 'enum', 'badge-enum');
    html += renderSection('Typedefs', data.typedefs, 'type', 'badge-typedef');
    html += renderSection('Functions', data.functions, 'fn', 'badge-function');
    html += renderSection('Variables', data.variables, 'var', 'badge-variable');

    // Render widget tree
    if (data.tree && data.tree.length > 0) {
      html += '<div class="class-list" style="border-bottom: none; padding-bottom: 0;"><div style="font-size: 11px; color: #888; font-weight: bold; margin-bottom: 4px; text-transform: uppercase;">UI Components</div></div>';
      html += renderTreeNodes(data.tree, 0);
    }
    
    const hasItems = (data.classNames && data.classNames.length > 0) || 
                     (data.functions && data.functions.length > 0) ||
                     (data.variables && data.variables.length > 0) ||
                     (data.enums && data.enums.length > 0) ||
                     (data.mixins && data.mixins.length > 0) ||
                     (data.extensions && data.extensions.length > 0) ||
                     (data.typedefs && data.typedefs.length > 0) ||
                     (data.tree && data.tree.length > 0);

    if (!hasItems) {
      html += '<div class="empty-state"><div class="empty-state-text">No code outline found in this file</div></div>';
    }

    treeView.innerHTML = html;

    // Add click handlers for class items
    treeView.querySelectorAll('.class-item').forEach(item => {
      item.addEventListener('click', () => {
        const line = parseInt(item.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'openFile', file: data.fileName, line: line });
      });
    });

    // Add handlers for widget nodes
    treeView.querySelectorAll('.tree-node').forEach(node => {
      node.addEventListener('click', () => {
        const line = parseInt(node.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'openFile', file: data.fileName, line: line });
        
        // Visual selection
        treeView.querySelectorAll('.tree-node').forEach(n => n.classList.remove('active'));
        node.classList.add('active');
      });
    });

    // Add handlers for toggles
    treeView.querySelectorAll('.tree-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = toggle.getAttribute('data-id');
        const childrenContainer = document.getElementById(`children-${nodeId}`);
        if (childrenContainer) {
          const isCollapsed = childrenContainer.style.display === 'none';
          childrenContainer.style.display = isCollapsed ? 'block' : 'none';
          toggle.textContent = isCollapsed ? '▼' : '▶';
          toggle.classList.toggle('collapsed', !isCollapsed);
        }
      });
    });
  }

  function renderTreeNodes(nodes, depth) {
    let html = '';
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const nodeId = Math.random().toString(36).substring(2, 9);
      const hasChildren = node.children && node.children.length > 0;
      
      // Indentation vertical guides
      let indentHtml = '';
      for (let d = 0; d < depth; d++) {
        indentHtml += '<span class="tree-indent"></span>';
      }

      // Extract detail from properties if present
      const detailProp = node.properties?.find(p => p.name === 'detail');
      const detail = detailProp ? detailProp.value : '';

      html += `<div class="tree-node" data-line="${node.line}">`;
      html += indentHtml;
      
      // Toggle button
      if (hasChildren) {
        html += `<span class="tree-toggle" data-id="${nodeId}">▼</span>`;
      } else {
        html += '<span style="width: 18px;"></span>';
      }

      // Icon
      html += `<span class="tree-icon">${getWidgetIcon(node.name)}</span>`;
      
      // Label & Detail
      html += `<span class="tree-label">${escapeHtml(node.name)}</span>`;
      if (detail) {
        html += `<span class="tree-detail">${escapeHtml(detail)}</span>`;
      }
      
      html += '</div>';

      if (hasChildren) {
        html += `<div id="children-${nodeId}" class="tree-children">`;
        html += renderTreeNodes(node.children, depth + 1);
        html += '</div>';
      }
    }
    return html;
  }

  function getWidgetIcon(name) {
    const icons = {
      'Scaffold': '🏗️',
      'AppBar': '🔝',
      'Container': '📦',
      'Column': '⬇️',
      'Row': '➡️',
      'Stack': '📚',
      'Text': '📄',
      'Icon': '🖼️',
      'Image': '🖼️',
      'Button': '🖱️',
      'Padding': '↔️',
      'Center': '🎯',
      'SizedBox': '📏',
      'ListView': '📜',
      'GridView': '🔳',
      'SingleChildScrollView': '📜',
      'GestureDetector': '👆',
      'InkWell': '👆',
      'TextField': '⌨️',
      'Navigator': '🧭',
      'StreamBuilder': '🌊',
      'FutureBuilder': '⏳',
      'Provider': '💉',
      'BlocBuilder': '🧱',
      'Consumer': '🛒',
    };
    return icons[name] || '◦';
  }

  function renderDependencyGraph(data) {
    const statsEl = document.getElementById('graphStats');
    const container = document.getElementById('graphContainer');
    if (!statsEl || !container) { return; }

    if (!data || !data.nodes || data.nodes.length === 0) {
      statsEl.innerHTML = '';
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No dependency data found.<br>Index Dart files first.</div></div>';
      return;
    }

    // Stats
    statsEl.innerHTML =
      '<span class="stat-item">📄 <span class="stat-value">' + data.stats.totalFiles + '</span> files</span>' +
      '<span class="stat-item">🔗 <span class="stat-value">' + data.stats.totalEdges + '</span> edges</span>';

    // Render as a list with import/imported-by info
    const nodeMap = {};
    for (let i = 0; i < data.nodes.length; i++) {
      nodeMap[data.nodes[i].id] = data.nodes[i];
    }

    // Group by folder
    const groups = {};
    for (let j = 0; j < data.nodes.length; j++) {
      const n = data.nodes[j];
      if (!groups[n.group]) { groups[n.group] = []; }
      groups[n.group].push(n);
    }

    let html = '';
    const groupKeys = Object.keys(groups).sort();
    for (let g = 0; g < groupKeys.length; g++) {
      const groupName = groupKeys[g];
      const groupNodes = groups[groupName];
      html += '<div class="graph-section-title">' + escapeHtml(groupName) + '/</div>';
      for (let k = 0; k < groupNodes.length; k++) {
        const gn = groupNodes[k];
        const imports = data.edges.filter(function (e) { return e.from === gn.id; }).length;
        const importedBy = data.edges.filter(function (e) { return e.to === gn.id; }).length;
        html += '<div class="graph-node" data-file="' + escapeHtml(gn.id) + '">';
        html += '<span class="graph-node-name">' + escapeHtml(gn.label) + '</span>';
        html += '<span class="graph-node-arrows">';
        if (imports > 0) { html += '→' + imports + ' '; }
        if (importedBy > 0) { html += '←' + importedBy; }
        html += '</span>';
        html += '</div>';
      }
    }
    container.innerHTML = html;

    // Click to open file
    container.querySelectorAll('.graph-node').forEach(function (node) {
      node.addEventListener('click', function () {
        const file = this.getAttribute('data-file');
        vscode.postMessage({ command: 'openFile', file: file, line: 1 });
      });
    });
  }

  function renderPubspec(data) {
    const container = document.getElementById('pubspecContent');
    if (!container) { return; }

    if (!data) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No pubspec.yaml found</div></div>';
      return;
    }

    let html = '';

    // Project Info
    html += '<div class="pubspec-section">';
    html += '<div class="pubspec-section-title">📋 Project Info</div>';
    if (data.name) { html += '<div class="pubspec-field"><span class="pubspec-field-name">Name</span><span class="pubspec-field-value">' + escapeHtml(data.name) + '</span></div>'; }
    if (data.version) { html += '<div class="pubspec-field"><span class="pubspec-field-name">Version</span><span class="pubspec-field-value">' + escapeHtml(data.version) + '</span></div>'; }
    if (data.sdkConstraint) { html += '<div class="pubspec-field"><span class="pubspec-field-name">SDK</span><span class="pubspec-field-value">' + escapeHtml(data.sdkConstraint) + '</span></div>'; }
    if (data.description) { html += '<div class="pubspec-field"><span class="pubspec-field-name">Description</span><span class="pubspec-field-value">' + escapeHtml(data.description) + '</span></div>'; }
    html += '</div>';

    // Warnings
    if (data.warnings && data.warnings.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">⚠️ Warnings</div>';
      for (let w = 0; w < data.warnings.length; w++) {
        html += '<div class="warning-item">' + escapeHtml(data.warnings[w]) + '</div>';
      }
      html += '</div>';
    }

    // Dependencies
    if (data.dependencies && data.dependencies.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">📦 Dependencies (' + data.dependencies.length + ')</div>';
      for (let d = 0; d < data.dependencies.length; d++) {
        const dep = data.dependencies[d];
        html += '<div class="dep-item">';
        html += '<span class="dep-name">' + escapeHtml(dep.name);
        if (dep.isPath) { html += '<span class="dep-badge dep-badge-path">path</span>'; }
        if (dep.isGit) { html += '<span class="dep-badge dep-badge-git">git</span>'; }
        html += '</span>';
        html += '<span class="dep-version">' + escapeHtml(dep.version) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Dev Dependencies
    if (data.devDependencies && data.devDependencies.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">🔧 Dev Dependencies (' + data.devDependencies.length + ')</div>';
      for (let dd = 0; dd < data.devDependencies.length; dd++) {
        const devDep = data.devDependencies[dd];
        html += '<div class="dep-item">';
        html += '<span class="dep-name">' + escapeHtml(devDep.name) + '</span>';
        html += '<span class="dep-version">' + escapeHtml(devDep.version) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Assets
    if (data.flutterAssets && data.flutterAssets.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">🖼️ Assets (' + data.flutterAssets.length + ')</div>';
      for (let a = 0; a < data.flutterAssets.length; a++) {
        html += '<div class="dep-item"><span class="dep-name">' + escapeHtml(data.flutterAssets[a]) + '</span></div>';
      }
      html += '</div>';
    }

    // Fonts
    if (data.flutterFonts && data.flutterFonts.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">🔤 Fonts (' + data.flutterFonts.length + ')</div>';
      for (let f = 0; f < data.flutterFonts.length; f++) {
        html += '<div class="dep-item"><span class="dep-name">' + escapeHtml(data.flutterFonts[f]) + '</span></div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  let lastAnalysisData = null;

  const typeFilterEl = document.getElementById('analysisTypeFilter');
  if (typeFilterEl) {
    typeFilterEl.addEventListener('change', function() {
      if (lastAnalysisData) renderAnalysisContent(lastAnalysisData);
    });
  }
  const colorFilterEl = document.getElementById('analysisColorFilter');
  if (colorFilterEl) {
    colorFilterEl.addEventListener('input', function() {
      if (lastAnalysisData) renderAnalysisContent(lastAnalysisData);
    });
  }
  const fileFilterEl = document.getElementById('analysisFileFilter');
  if (fileFilterEl) {
    fileFilterEl.addEventListener('input', function() {
      if (lastAnalysisData) renderAnalysisContent(lastAnalysisData);
    });
  }

  function renderAnalysis(data) {
    lastAnalysisData = data;
    renderAnalysisContent(data);
  }

  function renderAnalysisContent(data) {
    const container = document.getElementById('analysisContent');
    if (!container) { return; }

    const typeFilter = typeFilterEl ? typeFilterEl.value : 'all';
    const textFilter = colorFilterEl ? colorFilterEl.value.toLowerCase().trim() : '';
    const fileFilter = fileFilterEl ? fileFilterEl.value.toLowerCase().trim() : '';

    let html = '';

    // Missing Translations
    html += '<div class="pubspec-section">';
    html += '<div class="pubspec-section-title">🌐 Missing Translations</div>';
    
    const filteredTranslations = [];
    if (data.missingTranslations) {
      for (let i = 0; i < data.missingTranslations.length; i++) {
        const mt = data.missingTranslations[i];
        if (fileFilter && !mt.filePath.toLowerCase().includes(fileFilter)) continue;
        filteredTranslations.push(mt);
      }
    }

    if (filteredTranslations.length === 0 && data.missingTranslations && data.missingTranslations.length > 0) {
        html += '<div class="empty-state"><div class="empty-state-icon">🌐</div><div class="empty-state-text">No translations match the filter!</div></div>';
    } else if (!data.missingTranslations || data.missingTranslations.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-text">All ARB files are fully synced!</div></div>';
    } else {
      for (let i = 0; i < filteredTranslations.length; i++) {
        const mt = filteredTranslations[i];
        html += '<div class="dep-item" style="flex-direction: column; align-items: flex-start; padding: 8px;">';
        html += '<div class="dep-name" style="margin-bottom: 4px; font-weight: bold;">' + escapeHtml(mt.filePath) + '</div>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 4px;">';
        for (let k = 0; k < mt.missingKeys.length; k++) {
          html += '<span class="dep-badge dep-badge-path copy-key-btn" data-copy="' + escapeHtml(mt.missingKeys[k]) + '" title="Click to copy key" style="margin: 0; background: #5a1d1d; color: #ffb3b3; cursor: pointer;">' + escapeHtml(mt.missingKeys[k]) + ' 📋</span>';
        }
        html += '</div></div>';
      }
    }
    html += '</div>';

    // Hardcoded & Duplicate Warnings
    html += '<div class="pubspec-section">';
    html += '<div class="pubspec-section-title" style="display: flex; justify-content: space-between; align-items: center;">';
    html += '<span>⚠️ Hardcoded & Duplicated Code</span>';
    html += '<button class="copy-btn" id="copyAllAnalysisWarnings" title="Copy all visible warnings to clipboard" style="padding: 2px 6px; font-size: 10px; cursor: pointer; display: none;">📋 Copy All</button>';
    html += '</div>';
    
    const filteredWarnings = [];
    let allWarningsText = [];

    if (data.warnings) {
      for (let w = 0; w < data.warnings.length; w++) {
        const fileWarn = data.warnings[w];
        if (fileFilter && !fileWarn.filePath.toLowerCase().includes(fileFilter)) continue;
        
        const matchingWarns = fileWarn.warnings.filter(function(warn) {
          if (typeFilter !== 'all' && warn.type !== typeFilter) return false;
          if (textFilter && !warn.message.toLowerCase().includes(textFilter)) return false;
          return true;
        });

        if (matchingWarns.length > 0) {
          filteredWarnings.push({
            filePath: fileWarn.filePath,
            warnings: matchingWarns
          });

          for (let m = 0; m < matchingWarns.length; m++) {
            allWarningsText.push(fileWarn.filePath + ':L' + matchingWarns[m].line + ' - ' + matchingWarns[m].message);
          }
        }
      }
    }

    if (filteredWarnings.length === 0 && data.warnings && data.warnings.length > 0) {
      html += '<div class="empty-state"><div class="empty-state-text">No warnings match the filter!</div></div>';
    } else if (!data.warnings || data.warnings.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-text">No hardcoded strings or colors found!</div></div>';
    } else {
      for (let w = 0; w < filteredWarnings.length; w++) {
        const fileWarn = filteredWarnings[w];
        html += '<div class="dep-item analysis-file-link" data-file="' + escapeHtml(fileWarn.filePath) + '" style="display: flex; flex-direction: column; align-items: stretch; width: 100%; padding: 8px; cursor: pointer; box-sizing: border-box;">';
        html += '<div class="dep-name" style="margin-bottom: 4px; font-weight: bold; width: 100%;">' + escapeHtml(fileWarn.filePath) + ' (' + fileWarn.warnings.length + ')</div>';
        for (let k = 0; k < fileWarn.warnings.length; k++) {
          const warn = fileWarn.warnings[k];
          const bgColor = warn.type === 'hardcoded_text' ? '#3d3800' : 
                        warn.type === 'hardcoded_color' ? '#1a3d1a' : '#4d1a4d'; // Purple for duplicated logic
          const fgColor = warn.type === 'hardcoded_text' ? '#e2c08d' : 
                        warn.type === 'hardcoded_color' ? '#73c991' : '#e699ff';

          let cleanVal = warn.message;
          if (warn.message.indexOf('Hardcoded text: ') === 0) {
            cleanVal = warn.message.substring(16);
          } else if (warn.message.indexOf('Hardcoded color: ') === 0) {
            cleanVal = warn.message.substring(17);
          } else if (warn.message.indexOf('Duplicated logic: ') === 0) {
            cleanVal = warn.message.substring(18);
          }

          html += '<div class="warning-item analysis-warn-link" data-file="' + escapeHtml(fileWarn.filePath) + '" data-line="' + warn.line + '" style="width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; box-sizing: border-box;">';
          html += '<span style="flex: 1; word-break: break-all; font-size: 11px;">' + escapeHtml(warn.message) + '</span>';
          html += '<div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">';
          html += '<button class="copy-btn copy-val-btn" title="Copy extracted value: ' + escapeHtml(cleanVal) + '" data-copy="' + escapeHtml(cleanVal) + '" style="padding: 2px 5px; font-size: 10px; background: rgba(0,122,204,0.3); color: #75beff; border: 1px solid rgba(0,122,204,0.5); font-weight: 600; cursor: pointer; border-radius: 4px;">📋 Copy</button>';
          html += '<span class="dep-badge" style="background: ' + bgColor + '; color: ' + fgColor + ';">L' + warn.line + '</span>';
          html += '</div></div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';

    container.innerHTML = html;

    // Show Copy All button if there are warnings
    const copyAllBtn = document.getElementById('copyAllAnalysisWarnings');
    if (copyAllBtn) {
      if (allWarningsText.length > 0) {
        copyAllBtn.style.display = 'inline-block';
        copyAllBtn.setAttribute('data-copy', allWarningsText.join('\n'));
      } else {
        copyAllBtn.style.display = 'none';
      }
    }

    // Add click listeners for Analysis tab
    container.querySelectorAll('.analysis-file-link').forEach(function (el) {
      el.addEventListener('click', function () {
        const file = this.getAttribute('data-file');
        window.vscodeApi.postMessage({ command: 'openFile', file: file, line: 1 });
      });
    });

    container.querySelectorAll('.analysis-warn-link').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); // prevent triggering the parent file click
        const file = this.getAttribute('data-file');
        const line = parseInt(this.getAttribute('data-line') || '1', 10);
        window.vscodeApi.postMessage({ command: 'openFile', file: file, line: line });
      });
    });

    container.querySelectorAll('.copy-key-btn, .copy-btn, .copy-val-btn').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        const text = this.getAttribute('data-copy');
        copyToClipboard(text, this);
      });
    });

    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const text = this.getAttribute('data-copy');
        copyToClipboard(text, this);
      });
    }
  }

  function renderPackages(data) {
    const container = document.getElementById('librariesContent');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📚</div><div class="empty-state-text">No packages found.<br>Run "flutter pub get" first.</div></div>';
      return;
    }

    let html = '';
    for (let i = 0; i < data.length; i++) {
      const pkg = data[i];
      html += '<div class="package-item">';
      html += '<div class="package-name">' + escapeHtml(pkg.name) + '</div>';
      html += '<div class="package-version">Version: ' + escapeHtml(pkg.version) + '</div>';
      html += '<div class="package-badges">';
      html += '<span class="package-badge badge-' + pkg.dependencyType + '">' + escapeHtml(pkg.dependencyType) + '</span>';
      html += '<span class="package-badge badge-' + pkg.source + '">' + escapeHtml(pkg.source) + '</span>';
      html += '</div></div>';
    }
    container.innerHTML = html;
  }

  function renderStats(stats) {
    const statsBar = document.getElementById('statsBar');
    if (!statsBar) { return; }
    statsBar.innerHTML =
      '<span class="stat-item" data-filter="all">📄 <span class="stat-value">' + stats.files + '</span> files</span>' +
      '<span class="stat-item" data-filter="class">🔷 <span class="stat-value">' + stats.classes + '</span> classes</span>' +
      '<span class="stat-item" data-filter="function">⚡ <span class="stat-value">' + stats.functions + '</span> functions</span>' +
      '<span class="stat-item" data-filter="widget">🧩 <span class="stat-value">' + stats.widgets + '</span> widgets</span>' +
      '<span class="stat-item" data-filter="enum">🟣 <span class="stat-value">' + (stats.enums || 0) + '</span> enums</span>' +
      '<span class="stat-item" data-filter="mixin">🟠 <span class="stat-value">' + (stats.mixins || 0) + '</span> mixins</span>' +
      '<span class="stat-item" data-filter="extension">🧬 <span class="stat-value">' + (stats.extensions || 0) + '</span> ext</span>' +
      '<span class="stat-item" data-filter="typedef">🏷️ <span class="stat-value">' + (stats.typedefs || 0) + '</span> type</span>' +
      '<span class="stat-item" data-filter="variable">💎 <span class="stat-value">' + (stats.variables || 0) + '</span> vars</span>' +
      '<span class="stat-item" data-filter="constructor">🛠️ <span class="stat-value">' + (stats.constructors || 0) + '</span> ctors</span>' +
      '<span class="stat-item" data-filter="property">🔑 <span class="stat-value">' + (stats.properties || 0) + '</span> props</span>' +
      '<span class="stat-item" data-filter="annotation">🏷️ <span class="stat-value">' + (stats.annotations || 0) + '</span> annos</span>' +
      '<span class="stat-item" data-filter="call">📞 <span class="stat-value">' + (stats.calls || 0) + '</span> calls</span>' +
      '<span class="stat-item" data-filter="translation">🌐 <span class="stat-value">' + (stats.translations || 0) + '</span> translations</span>';

    statsBar.querySelectorAll('.stat-item').forEach(function (item) {
      item.addEventListener('click', function () {
        const filter = this.getAttribute('data-filter');

        // Switch to search tab
        document.querySelector('.tab[data-tab="search"]')?.click();

        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        const filterBtn = document.querySelector('.filter-btn[data-filter="' + filter + '"]');
        if (filterBtn) filterBtn.classList.add('active');
        currentFilter = filter;

        // Clear search input and trigger search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        const appliedFilter = filter === 'all' ? undefined : filter;
        vscode.postMessage({ command: 'search', query: '', filter: appliedFilter });
      });
    });
  }

  // ─── Utilities ─────────────────────────────────────────

  function copyToClipboard(text, btnElement) {
    if (!text) { return; }
    window.vscodeApi.postMessage({ command: 'copyToClipboard', text: text });
    if (btnElement) {
      const orig = btnElement.innerHTML;
      btnElement.innerHTML = '✓';
      btnElement.classList.add('copied');
      setTimeout(function () {
        btnElement.innerHTML = orig;
        btnElement.classList.remove('copied');
      }, 1200);
    }
  }

  function escapeHtml(text) {
    if (!text) { return ''; }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Initial Load ─────────────────────────────────────

  vscode.postMessage({ command: 'getStats' });
  vscode.postMessage({ command: 'getWidgetTree' });
  vscode.postMessage({ command: 'getDependencyGraph' });
  vscode.postMessage({ command: 'getPubspec' });
})();
