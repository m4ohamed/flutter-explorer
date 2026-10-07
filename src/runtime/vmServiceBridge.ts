import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

export interface VmErrorLog {
  timestamp: string;
  kind: string;
  message: string;
  stackTrace?: string;
  details?: any;
}

interface Pending {
  resolve: (val: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface VmServiceBridgeOptions {
  /**
   * Close the socket after this many ms without a request. Useful for short lived instances
   * (extension commands) that would otherwise leak a connection. Default: stay connected.
   */
  idleDisconnectMs?: number;
}

/** True when a VM-service error means "the isolate id we used is no longer valid". */
function isStaleIsolateError(message: string): boolean {
  return /sentinel/i.test(message) ||
    (/isolate/i.test(message) && /(not found|invalid|exited|collected|cannot find|expired)/i.test(message));
}

/** Flutter Driver finder serialisation (all values must be strings in service extension params). */
function driverFinders(target: string): Array<Record<string, string>> {
  const t = target.trim();
  const prefixed = /^(key|text|tooltip|label|type):(.*)$/s.exec(t);
  if (prefixed) {
    const value = prefixed[2];
    switch (prefixed[1]) {
      case 'key': return [{ finderType: 'ByValueKey', keyValueString: value, keyValueType: 'String' }];
      case 'text': return [{ finderType: 'ByText', text: value }];
      case 'tooltip': return [{ finderType: 'ByTooltipMessage', text: value }];
      case 'label': return [{ finderType: 'BySemanticsLabel', label: value }];
      case 'type': return [{ finderType: 'ByType', type: value }];
    }
  }
  if (t.startsWith('#')) {
    return [{ finderType: 'ByValueKey', keyValueString: t.slice(1), keyValueType: 'String' }];
  }
  // A bare string: try it as a ValueKey first, then as visible text.
  return [
    { finderType: 'ByValueKey', keyValueString: t, keyValueType: 'String' },
    { finderType: 'ByText', text: t },
  ];
}

export class VmServiceBridge {
  private projectRoot: string;
  private ws: WebSocket | null = null;
  private activeUri: string | null = null;
  private nextId = 1;
  private pendingRequests: Map<string, Pending> = new Map();
  private errorLogs: VmErrorLog[] = [];
  private mainIsolateId: string | null = null;
  /** service name (e.g. "reloadSources") -> callable method name (e.g. "s0.reloadSources") */
  private registeredServices: Map<string, string> = new Map();
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(projectRoot: string, private options: VmServiceBridgeOptions = {}) {
    this.projectRoot = projectRoot;
  }

  /**
   * Attempts to discover the running VM service URI from the project environment,
   * or uses the provided URI.
   */
  public async discoverVmServiceUri(): Promise<string | null> {
    // 1. Check environment variable
    if (process.env.DART_VM_SERVICE_URI) {
      return process.env.DART_VM_SERVICE_URI;
    }

    // 2. Check .dart_tool/ for vm service or dtd files
    const dartTool = path.join(this.projectRoot, '.dart_tool');
    if (fs.existsSync(dartTool)) {
      const candidates = [
        path.join(dartTool, 'dart_tooling_daemon.json'),
        path.join(dartTool, 'flutter_service.json'),
        path.join(dartTool, 'vm_service_uri.txt')
      ];

      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            const content = fs.readFileSync(cand, 'utf-8').trim();
            if (content.startsWith('{')) {
              const parsed = JSON.parse(content);
              const uri = parsed.uri || parsed.toolingDaemonUri || parsed.vmServiceUri;
              if (uri) { return uri; }
            } else if (content.startsWith('http') || content.startsWith('ws')) {
              return content;
            }
          } catch {
            // continue
          }
        }
      }
    }

    return null;
  }

  private isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Connect to the Dart VM Service via WebSocket
   */
  public async connect(overrideUri?: string): Promise<{ success: boolean; uri: string; message: string }> {
    const rawUri = overrideUri || await this.discoverVmServiceUri();
    if (!rawUri) {
      return {
        success: false,
        uri: '',
        message: 'No running Flutter/Dart VM Service found. Start your app with `flutter run` and specify the VM Service URI, or enable DTD.'
      };
    }

    // Normalize HTTP/HTTPS to WS/WSS
    let wsUri = rawUri;
    if (wsUri.startsWith('http://')) {
      wsUri = 'ws://' + wsUri.substring(7);
    } else if (wsUri.startsWith('https://')) {
      wsUri = 'wss://' + wsUri.substring(8);
    }

    if (!wsUri.endsWith('/ws')) {
      wsUri = wsUri.replace(/\/+$/, '') + '/ws';
    }

    if (this.isOpen() && this.activeUri === wsUri) {
      this.touch();
      return { success: true, uri: wsUri, message: 'Already connected to VM Service.' };
    }

    this.disconnect();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { success: boolean; uri: string; message: string }): void => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUri);
      } catch (err: any) {
        resolve({ success: false, uri: wsUri, message: `Failed to open connection: ${err.message}` });
        return;
      }
      this.ws = socket;
      this.activeUri = wsUri;

      const timeout = setTimeout(() => {
        if (!settled) {
          try { socket.terminate(); } catch { /* ignore */ }
          finish({ success: false, uri: wsUri, message: 'Connection to VM Service timed out (5s).' });
        }
      }, 5000);

      socket.on('open', async () => {
        // Subscribe to the streams we use. Failures (e.g. "already subscribed") are not fatal.
        for (const streamId of ['Extension', 'Stderr', 'Isolate', 'Service']) {
          try { await this.call('streamListen', { streamId }); } catch { /* ignore */ }
        }
        try { await this.refreshIsolates(); } catch { /* ignore */ }
        this.touch();
        finish({ success: true, uri: wsUri, message: 'Connected to Dart VM Service successfully.' });
      });

      socket.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      socket.on('error', (err: Error) => {
        finish({ success: false, uri: wsUri, message: `WebSocket error: ${err.message || 'Connection failed'}` });
      });

      socket.on('close', () => {
        if (this.ws === socket) {
          this.ws = null;
          this.mainIsolateId = null;
          this.registeredServices.clear();
          this.rejectAllPending(new Error('VM Service connection closed'));
        }
        finish({ success: false, uri: wsUri, message: 'VM Service closed the connection.' });
      });
    });
  }

  public disconnect(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const socket = this.ws;
    this.ws = null;
    this.activeUri = null;
    this.mainIsolateId = null;
    this.registeredServices.clear();
    this.rejectAllPending(new Error('VM Service connection closed'));
    if (socket) {
      try { socket.close(); } catch { /* ignore */ }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }

  private touch(): void {
    if (!this.options.idleDisconnectMs) { return; }
    if (this.idleTimer) { clearTimeout(this.idleTimer); }
    this.idleTimer = setTimeout(() => this.disconnect(), this.options.idleDisconnectMs);
    this.idleTimer.unref?.();
  }

  private handleMessage(text: string): void {
    try {
      const msg = JSON.parse(text);

      // RPC response
      if (msg.id !== undefined && msg.id !== null) {
        const key = String(msg.id);
        const req = this.pendingRequests.get(key);
        if (req) {
          this.pendingRequests.delete(key);
          clearTimeout(req.timer);
          if (msg.error) {
            req.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            req.resolve(msg.result);
          }
        }
        return;
      }

      // Stream event
      if (msg.method === 'streamNotify') {
        const params = msg.params || {};
        const event = params.event || {};
        const streamId = params.streamId;

        if (streamId === 'Service') {
          if (event.kind === 'ServiceRegistered' && event.service && event.method) {
            this.registeredServices.set(String(event.service), String(event.method));
          } else if (event.kind === 'ServiceUnregistered' && event.service) {
            this.registeredServices.delete(String(event.service));
          }
          return;
        }

        if (streamId === 'Isolate') {
          const iso = event.isolate || {};
          if (event.kind === 'IsolateExit' && iso.id === this.mainIsolateId) {
            this.mainIsolateId = null; // e.g. after a hot restart the old isolate exits
          }
          return;
        }

        // Catch Flutter errors
        if (event.extensionKind === 'Flutter.Error') {
          const data = event.extensionData || {};
          this.pushError({
            timestamp: new Date().toISOString(),
            kind: 'Flutter.Error',
            message: data.renderedError || data.description || 'Flutter Framework Error',
            details: data
          });
        } else if (streamId === 'Stderr') {
          const bytes = event.bytes ? Buffer.from(event.bytes, 'base64').toString('utf-8') : '';
          if (bytes.trim()) {
            this.pushError({ timestamp: new Date().toISOString(), kind: 'Stderr', message: bytes.trim() });
          }
        }
      }
    } catch (e) {
      console.error('[VmServiceBridge] Error handling message:', e);
    }
  }

  private pushError(entry: VmErrorLog): void {
    this.errorLogs.unshift(entry);
    if (this.errorLogs.length > 50) { this.errorLogs.pop(); }
  }

  private call(method: string, params: Record<string, any> = {}, timeoutMs = 10000): Promise<any> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('VM Service is not connected. Call connect() first.'));
    }

    const id = String(this.nextId++);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(new Error(`RPC call '${method}' timed out after ${Math.round(timeoutMs / 1000)} seconds`));
        }
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      socket.send(payload, (err?: Error) => {
        if (err && this.pendingRequests.delete(id)) {
          clearTimeout(timer);
          reject(err);
        }
      });
    }).finally(() => this.touch());
  }

  /**
   * Pick the isolate that runs the Flutter app: the one exposing `ext.flutter.*` extensions,
   * otherwise the one named "main", otherwise the first.
   */
  private async refreshIsolates(): Promise<string | null> {
    try {
      const vm = await this.call('getVM');
      const isolates: any[] = vm.isolates || [];
      if (isolates.length === 0) { return null; }

      let chosen: any | undefined;
      for (const ref of isolates) {
        try {
          const iso = await this.call('getIsolate', { isolateId: ref.id });
          const rpcs: string[] = iso.extensionRPCs || [];
          if (rpcs.some(r => r.startsWith('ext.flutter.'))) { chosen = ref; break; }
        } catch {
          // keep looking
        }
      }
      chosen = chosen || isolates.find((i: any) => i.name === 'main') || isolates[0];
      this.mainIsolateId = chosen.id;
      return this.mainIsolateId;
    } catch {
      return null;
    }
  }

  private async getIsolateId(): Promise<string> {
    if (this.mainIsolateId) { return this.mainIsolateId; }
    const id = await this.refreshIsolates();
    if (!id) { throw new Error('No active Dart Isolates found on the running application.'); }
    return id;
  }

  /** Run `fn` with the main isolate; if the id turned out to be stale (after a restart) refresh it once. */
  private async withIsolate<T>(fn: (isolateId: string) => Promise<T>): Promise<T> {
    const id = await this.getIsolateId();
    try {
      return await fn(id);
    } catch (err: any) {
      if (!isStaleIsolateError(String(err?.message ?? err))) { throw err; }
      this.mainIsolateId = null;
      const fresh = await this.getIsolateId();
      return fn(fresh);
    }
  }

  /** Wait for a service registration event (they arrive right after streamListen('Service')). */
  private async waitForService(name: string, timeoutMs = 1500): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const method = this.registeredServices.get(name);
      if (method) { return method; }
      await new Promise(r => setTimeout(r, 50));
    }
    return this.registeredServices.get(name) ?? null;
  }

  private static missingServiceMessage(what: string, service: string): string {
    return `${what} needs the "${service}" service that \`flutter run\` / \`flutter attach\` registers on the VM Service, ` +
      'but it was not found. Start the app through the Flutter tool (or attach to it) and try again. ' +
      '(Calling ext.flutter.reassemble alone only rebuilds the widget tree; it does not load changed code.)';
  }

  /**
   * Hot reload: asks the Flutter tool (through the registered "reloadSources" service) to sync the
   * changed files and reload them into the running isolate.
   */
  public async hotReload(vmUri?: string): Promise<{ success: boolean; durationMs?: number; message: string; report?: any }> {
    const conn = await this.connect(vmUri);
    if (!conn.success) { return { success: false, message: conn.message }; }

    const method = await this.waitForService('reloadSources');
    if (!method) {
      return { success: false, message: VmServiceBridge.missingServiceMessage('Hot Reload', 'reloadSources') };
    }

    const start = Date.now();
    try {
      const report = await this.withIsolate(isolateId =>
        this.call(method, { isolateId, force: false, pause: false }, 60000));
      const durationMs = Date.now() - start;
      if (report && report.success === false) {
        return { success: false, durationMs, message: `Hot Reload was rejected: ${JSON.stringify(report.details ?? report)}`, report };
      }
      return { success: true, durationMs, message: `Hot Reload completed in ${durationMs}ms.`, report };
    } catch (err: any) {
      return { success: false, message: `Hot Reload failed: ${err.message}` };
    }
  }

  /**
   * Full hot restart through the Flutter tool's "hotRestart" service. The isolate id changes
   * afterwards, so it is re-discovered before this method returns.
   */
  public async hotRestart(vmUri?: string): Promise<{ success: boolean; durationMs?: number; message: string }> {
    const conn = await this.connect(vmUri);
    if (!conn.success) { return { success: false, message: conn.message }; }

    const method = await this.waitForService('hotRestart');
    if (!method) {
      return { success: false, message: VmServiceBridge.missingServiceMessage('Hot Restart', 'hotRestart') };
    }

    const start = Date.now();
    try {
      const previous = this.mainIsolateId;
      await this.withIsolate(isolateId => this.call(method, { isolateId }, 60000));
      this.mainIsolateId = null;

      // The new isolate shows up shortly after the restart; wait for it so later calls use it.
      let fresh: string | null = null;
      for (let i = 0; i < 50 && !fresh; i++) {
        const candidate = await this.refreshIsolates();
        if (candidate && candidate !== previous) { fresh = candidate; }
        else { await new Promise(r => setTimeout(r, 100)); }
      }
      if (!fresh) { await this.refreshIsolates(); }

      const durationMs = Date.now() - start;
      return { success: true, durationMs, message: `Hot Restart completed in ${durationMs}ms.` };
    } catch (err: any) {
      return { success: false, message: `Hot Restart failed: ${err.message}` };
    }
  }

  /** Rebuild the whole widget tree (ext.flutter.reassemble). This does NOT load new code. */
  public async reassemble(vmUri?: string): Promise<{ success: boolean; message: string }> {
    const conn = await this.connect(vmUri);
    if (!conn.success) { return { success: false, message: conn.message }; }
    try {
      await this.withIsolate(isolateId => this.call('ext.flutter.reassemble', { isolateId }));
      return { success: true, message: 'Widget tree reassembled (no code was reloaded).' };
    } catch (err: any) {
      return { success: false, message: `Reassemble failed: ${err.message}` };
    }
  }

  /**
   * Fetches recent runtime errors, unhandled exceptions, and stderr logs from the running app
   */
  public async getRuntimeErrors(vmUri?: string): Promise<{
    count: number;
    errors: VmErrorLog[];
    status: string;
  }> {
    if (!this.isOpen()) {
      const conn = await this.connect(vmUri);
      if (!conn.success) {
        return { count: 0, errors: [], status: conn.message };
      }
    }

    return {
      count: this.errorLogs.length,
      errors: [...this.errorLogs],
      status: 'Connected to live application VM Service.'
    };
  }

  /**
   * Inspects the live running widget tree using Flutter Inspector service extensions
   */
  public async inspectLiveWidgets(vmUri?: string, objectGroup = 'flutter_explorer_group'): Promise<any> {
    const conn = await this.connect(vmUri);
    if (!conn.success) { return { success: false, message: conn.message }; }

    try {
      return await this.withIsolate(async (isolateId) => {
        let widgetTree: any;
        let source = 'summaryTree';
        try {
          widgetTree = await this.call('ext.flutter.inspector.getRootWidgetSummaryTree', { isolateId, objectGroup });
        } catch {
          source = 'rootWidget';
          widgetTree = await this.call('ext.flutter.inspector.getRootWidget', { isolateId, objectGroup });
        }
        // Release the references the inspector keeps alive for this group.
        this.call('ext.flutter.inspector.disposeGroup', { isolateId, objectGroup }).catch(() => undefined);
        return { success: true, isolateId, source, widgetTree };
      });
    } catch (err: any) {
      return { success: false, message: `Failed to inspect widget tree: ${err.message}` };
    }
  }

  private async driver(isolateId: string, params: Record<string, string>): Promise<any> {
    const res = await this.call('ext.flutter.driver', { isolateId, ...params }, 20000);
    if (res && res.isError === true) {
      const detail = res.response?.message ?? res.response ?? 'Flutter Driver reported an error';
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return res;
  }

  /**
   * Simulates user UI actions (tap, enterText, scroll) through the Flutter Driver extension.
   *
   * `target` is a finder: "key:loginButton", "text:Sign in", "tooltip:Back", "label:Menu",
   * "type:ElevatedButton"; a bare string is tried as a ValueKey and then as visible text.
   * The app must call `enableFlutterDriverExtension()`. If it does not, the result is
   * `success: false` -- nothing is reported as done unless the driver confirmed it.
   */
  public async simulateUiAction(
    action: 'tap' | 'enterText' | 'scroll',
    target: string,
    value?: string,
    vmUri?: string
  ): Promise<{ success: boolean; action: string; target: string; message: string; details?: any; performed?: boolean }> {
    const conn = await this.connect(vmUri);
    if (!conn.success) { return { success: false, action, target, message: conn.message, performed: false }; }

    try {
      return await this.withIsolate(async (isolateId) => {
        let driverMissing = false;
        let lastError = '';

        for (const finder of driverFinders(target)) {
          try {
            let res: any;
            if (action === 'tap') {
              res = await this.driver(isolateId, { command: 'tap', timeout: '5000', ...finder });
            } else if (action === 'enterText') {
              await this.driver(isolateId, { command: 'tap', timeout: '5000', ...finder }); // focus the field
              await this.driver(isolateId, { command: 'set_text_entry_emulation', enabled: 'true' });
              res = await this.driver(isolateId, { command: 'enter_text', text: value ?? '' });
            } else {
              const dy = Number.parseInt(value ?? '-300', 10);
              res = await this.driver(isolateId, {
                command: 'scroll',
                dx: '0',
                dy: String(Number.isFinite(dy) ? dy : -300),
                duration: '300000', // microseconds
                frequency: '60',
                timeout: '5000',
                ...finder,
              });
            }
            const verb = action === 'tap' ? 'Tapped' : action === 'enterText' ? 'Entered text into' : 'Scrolled';
            return { success: true, performed: true, action, target, message: `${verb} "${target}" (${finder.finderType}).`, details: res };
          } catch (err: any) {
            const message = String(err?.message ?? err);
            lastError = message;
            if (/method not found|-32601|unknown method/i.test(message)) { driverMissing = true; break; }
            if (isStaleIsolateError(message)) { throw err; }
            // finder did not match: try the next one
          }
        }

        if (driverMissing) {
          return {
            success: false,
            performed: false,
            action,
            target,
            message: 'The Flutter Driver extension is not enabled in the running app, so nothing was done. ' +
              'Call enableFlutterDriverExtension() from flutter_driver in a debug entry point (for example lib/main_driver.dart) and run that target.',
          };
        }
        return {
          success: false,
          performed: false,
          action,
          target,
          message: `Flutter Driver could not complete "${action}" on "${target}": ${lastError || 'no finder matched'}`,
        };
      });
    } catch (err: any) {
      return { success: false, performed: false, action, target, message: `Failed to simulate UI action: ${err.message}` };
    }
  }
}
