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
      var targetTab = this.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (tc) { tc.classList.remove('active'); });
      this.classList.add('active');
      var targetEl = document.getElementById('tab-' + targetTab);
      if (targetEl) { targetEl.classList.add('active'); }

      // Load data for tab
      if (targetTab === 'tree') { vscode.postMessage({ command: 'getWidgetTree' }); }
      else if (targetTab === 'graph') { vscode.postMessage({ command: 'getDependencyGraph' }); }
      else if (targetTab === 'pubspec') { vscode.postMessage({ command: 'getPubspec' }); }
      else if (targetTab === 'analysis') { vscode.postMessage({ command: 'getAnalysis' }); }
    });
  });

  // ─── Search ────────────────────────────────────────────

  var searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      if (searchTimeout) { clearTimeout(searchTimeout); }
      searchTimeout = setTimeout(function () {
        var query = searchInput.value;
        var filter = currentFilter === 'all' ? undefined : currentFilter;
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
        var filter = currentFilter === 'all' ? undefined : currentFilter;
        vscode.postMessage({ command: 'search', query: searchInput.value, filter: filter });
      }
    });
  });

  // ─── Refresh Buttons ──────────────────────────────────

  var refreshTree = document.getElementById('refreshTree');
  if (refreshTree) {
    refreshTree.addEventListener('click', function () {
      vscode.postMessage({ command: 'getWidgetTree' });
    });
  }

  var refreshGraph = document.getElementById('refreshGraph');
  if (refreshGraph) {
    refreshGraph.addEventListener('click', function () {
      vscode.postMessage({ command: 'getDependencyGraph' });
    });
  }

  var refreshPubspec = document.getElementById('refreshPubspec');
  if (refreshPubspec) {
    refreshPubspec.addEventListener('click', function () {
      vscode.postMessage({ command: 'getPubspec' });
    });
  }

  var refreshAnalysis = document.getElementById('refreshAnalysis');
  if (refreshAnalysis) {
    refreshAnalysis.addEventListener('click', function () {
      vscode.postMessage({ command: 'getAnalysis' });
    });
  }

  // ─── Message Handler ──────────────────────────────────

  window.addEventListener('message', function (event) {
    var message = event.data;
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
    }
  });

  // ─── Render Functions ─────────────────────────────────

  function renderSearchResults(results) {
    var container = document.getElementById('searchResults');
    if (!container) { return; }

    if (!results || results.length === 0) {
      var q = searchInput ? searchInput.value : '';
      container.innerHTML = q
        ? '<div class="no-results">No results found for "' + escapeHtml(q) + '"</div>'
        : '<div class="no-results">Start typing to search...</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
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
      html += '</div>';
    }
    container.innerHTML = html;

    // Add click handlers
    container.querySelectorAll('.result-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var file = this.getAttribute('data-file');
        var line = parseInt(this.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'openFile', file: file, line: line });
      });
    });
  }

  function renderWidgetTree(data) {
    var fileNameEl = document.getElementById('treeFileName');
    var treeView = document.getElementById('treeView');
    if (!fileNameEl || !treeView) { return; }

    if (!data || !data.fileName) {
      fileNameEl.textContent = 'No Dart file open';
      treeView.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🌳</div><div class="empty-state-text">Open a Dart file to see its widget tree</div></div>';
      return;
    }

    fileNameEl.textContent = data.fileName;

    var html = '';

    // Render classes
    if (data.classNames && data.classNames.length > 0) {
      html += '<div class="class-list">';
      for (var i = 0; i < data.classNames.length; i++) {
        var cls = data.classNames[i];
        html += '<div class="class-item" data-line="' + cls.line + '">';
        html += '<span class="class-type-badge">' + cls.type + '</span>';
        html += '<span>' + escapeHtml(cls.name) + '</span>';
        html += '</div>';
      }
      html += '</div>';
    }

    // Render widget tree
    if (data.tree && data.tree.length > 0) {
      html += renderTreeNodes(data.tree, 0);
    } else {
      html += '<div class="empty-state"><div class="empty-state-text">No widget tree found in build() method</div></div>';
    }

    treeView.innerHTML = html;

    // Add click handlers for class items
    treeView.querySelectorAll('.class-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var line = parseInt(this.getAttribute('data-line') || '1', 10);
        vscode.postMessage({ command: 'openFile', file: data.fileName, line: line });
      });
    });
  }

  function renderTreeNodes(nodes, depth) {
    var html = '';
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var indentHtml = '';
      for (var d = 0; d < depth; d++) {
        indentHtml += '<span class="tree-indent"></span>';
      }
      var hasChildren = node.children && node.children.length > 0;
      html += '<div class="tree-node">';
      html += indentHtml;
      html += '<span class="tree-icon">' + (hasChildren ? '▸' : '◦') + '</span>';
      html += '<span class="tree-label">' + escapeHtml(node.name) + '</span>';
      html += '</div>';

      if (hasChildren) {
        html += renderTreeNodes(node.children, depth + 1);
      }
    }
    return html;
  }

  function renderDependencyGraph(data) {
    var statsEl = document.getElementById('graphStats');
    var container = document.getElementById('graphContainer');
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
    var nodeMap = {};
    for (var i = 0; i < data.nodes.length; i++) {
      nodeMap[data.nodes[i].id] = data.nodes[i];
    }

    // Group by folder
    var groups = {};
    for (var j = 0; j < data.nodes.length; j++) {
      var n = data.nodes[j];
      if (!groups[n.group]) { groups[n.group] = []; }
      groups[n.group].push(n);
    }

    var html = '';
    var groupKeys = Object.keys(groups).sort();
    for (var g = 0; g < groupKeys.length; g++) {
      var groupName = groupKeys[g];
      var groupNodes = groups[groupName];
      html += '<div class="graph-section-title">' + escapeHtml(groupName) + '/</div>';
      for (var k = 0; k < groupNodes.length; k++) {
        var gn = groupNodes[k];
        var imports = data.edges.filter(function (e) { return e.from === gn.id; }).length;
        var importedBy = data.edges.filter(function (e) { return e.to === gn.id; }).length;
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
        var file = this.getAttribute('data-file');
        vscode.postMessage({ command: 'openFile', file: file, line: 1 });
      });
    });
  }

  function renderPubspec(data) {
    var container = document.getElementById('pubspecContent');
    if (!container) { return; }

    if (!data) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">No pubspec.yaml found</div></div>';
      return;
    }

    var html = '';

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
      for (var w = 0; w < data.warnings.length; w++) {
        html += '<div class="warning-item">' + escapeHtml(data.warnings[w]) + '</div>';
      }
      html += '</div>';
    }

    // Dependencies
    if (data.dependencies && data.dependencies.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">📦 Dependencies (' + data.dependencies.length + ')</div>';
      for (var d = 0; d < data.dependencies.length; d++) {
        var dep = data.dependencies[d];
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
      for (var dd = 0; dd < data.devDependencies.length; dd++) {
        var devDep = data.devDependencies[dd];
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
      for (var a = 0; a < data.flutterAssets.length; a++) {
        html += '<div class="dep-item"><span class="dep-name">' + escapeHtml(data.flutterAssets[a]) + '</span></div>';
      }
      html += '</div>';
    }

    // Fonts
    if (data.flutterFonts && data.flutterFonts.length > 0) {
      html += '<div class="pubspec-section">';
      html += '<div class="pubspec-section-title">🔤 Fonts (' + data.flutterFonts.length + ')</div>';
      for (var f = 0; f < data.flutterFonts.length; f++) {
        html += '<div class="dep-item"><span class="dep-name">' + escapeHtml(data.flutterFonts[f]) + '</span></div>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function renderAnalysis(data) {
    var container = document.getElementById('analysisContent');
    if (!container) { return; }

    var html = '';

    // Missing Translations
    html += '<div class="pubspec-section">';
    html += '<div class="pubspec-section-title">🌐 Missing Translations</div>';
    if (!data.missingTranslations || data.missingTranslations.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-text">All ARB files are fully synced!</div></div>';
    } else {
      for (var i = 0; i < data.missingTranslations.length; i++) {
        var mt = data.missingTranslations[i];
        html += '<div class="dep-item" style="flex-direction: column; align-items: flex-start; padding: 8px;">';
        html += '<div class="dep-name" style="margin-bottom: 4px; font-weight: bold;">' + escapeHtml(mt.filePath) + '</div>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 4px;">';
        for (var k = 0; k < mt.missingKeys.length; k++) {
          html += '<span class="dep-badge dep-badge-path" style="margin: 0; background: #5a1d1d; color: #ffb3b3;">' + escapeHtml(mt.missingKeys[k]) + '</span>';
        }
        html += '</div></div>';
      }
    }
    html += '</div>';

    // Hardcoded Warnings
    html += '<div class="pubspec-section">';
    html += '<div class="pubspec-section-title">⚠️ Hardcoded Text & Colors</div>';
    if (!data.warnings || data.warnings.length === 0) {
      html += '<div class="empty-state"><div class="empty-state-text">No hardcoded strings or colors found!</div></div>';
    } else {
      for (var w = 0; w < data.warnings.length; w++) {
        var fileWarn = data.warnings[w];
        html += '<div class="dep-item analysis-file-link" data-file="' + escapeHtml(fileWarn.filePath) + '" style="flex-direction: column; align-items: flex-start; padding: 8px; cursor: pointer;">';
        html += '<div class="dep-name" style="margin-bottom: 4px; font-weight: bold;">' + escapeHtml(fileWarn.filePath) + ' (' + fileWarn.warnings.length + ')</div>';
        for (var k = 0; k < fileWarn.warnings.length; k++) {
          var warn = fileWarn.warnings[k];
          var bgColor = warn.type === 'hardcoded_text' ? '#3d3800' : '#1a3d1a';
          var fgColor = warn.type === 'hardcoded_text' ? '#e2c08d' : '#73c991';
          html += '<div class="warning-item analysis-warn-link" data-file="' + escapeHtml(fileWarn.filePath) + '" data-line="' + warn.line + '" style="width: 100%; display: flex; justify-content: space-between;">';
          html += '<span>' + escapeHtml(warn.message) + '</span>';
          html += '<span class="dep-badge" style="background: ' + bgColor + '; color: ' + fgColor + ';">L' + warn.line + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
    }
    html += '</div>';

    container.innerHTML = html;

    // Add click listeners for Analysis tab
    container.querySelectorAll('.analysis-file-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var file = this.getAttribute('data-file');
        window.vscodeApi.postMessage({ command: 'openFile', file: file, line: 1 });
      });
    });

    container.querySelectorAll('.analysis-warn-link').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation(); // prevent triggering the parent file click
        var file = this.getAttribute('data-file');
        var line = parseInt(this.getAttribute('data-line') || '1', 10);
        window.vscodeApi.postMessage({ command: 'openFile', file: file, line: line });
      });
    });
  }

  function renderStats(stats) {
    var statsBar = document.getElementById('statsBar');
    if (!statsBar) { return; }
    statsBar.innerHTML =
      '<span class="stat-item" data-filter="all">📄 <span class="stat-value">' + stats.files + '</span> files</span>' +
      '<span class="stat-item" data-filter="class">🔷 <span class="stat-value">' + stats.classes + '</span> classes</span>' +
      '<span class="stat-item" data-filter="function">⚡ <span class="stat-value">' + stats.functions + '</span> functions</span>' +
      '<span class="stat-item" data-filter="widget">🧩 <span class="stat-value">' + stats.widgets + '</span> widgets</span>' +
      '<span class="stat-item" data-filter="translation">🌐 <span class="stat-value">' + (stats.translations || 0) + '</span> translations</span>';

    statsBar.querySelectorAll('.stat-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var filter = this.getAttribute('data-filter');

        // Switch to search tab
        document.querySelector('.tab[data-tab="search"]')?.click();

        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        var filterBtn = document.querySelector('.filter-btn[data-filter="' + filter + '"]');
        if (filterBtn) filterBtn.classList.add('active');
        currentFilter = filter;

        // Clear search input and trigger search
        var searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        var appliedFilter = filter === 'all' ? undefined : filter;
        vscode.postMessage({ command: 'search', query: '', filter: appliedFilter });
      });
    });
  }

  // ─── Utilities ─────────────────────────────────────────

  function escapeHtml(text) {
    if (!text) { return ''; }
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── Initial Load ─────────────────────────────────────

  vscode.postMessage({ command: 'getStats' });
})();
