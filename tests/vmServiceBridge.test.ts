import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { AddressInfo } from 'net';
import { VmServiceBridge } from '../src/runtime/vmServiceBridge';

interface MockOptions { registerServices?: boolean; driver?: boolean }

/** A tiny fake of the Dart VM service protocol (JSON-RPC over WebSocket). */
function startMock(opts: MockOptions = {}) {
  const { registerServices = true, driver = true } = opts;
  const wss = new WebSocketServer({ port: 0 });
  const log: Array<{ method: string; params: any }> = [];
  let isolateCounter = 1;
  let currentIsolate = 'isolates/1';
  const sockets = new Set<WebSocket>();

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('message', (raw) => {
      const req = JSON.parse(raw.toString());
      log.push({ method: req.method, params: req.params });
      const reply = (result: any) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
      const fail = (code: number, message: string) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code, message } }));
      const notify = (streamId: string, event: any) => socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'streamNotify', params: { streamId, event } }));
      const checkIsolate = () => req.params?.isolateId === currentIsolate;

      switch (req.method) {
        case 'streamListen':
          reply({ type: 'Success' });
          if (req.params.streamId === 'Service' && registerServices) {
            notify('Service', { kind: 'ServiceRegistered', service: 'reloadSources', method: 's0.reloadSources', alias: 'Flutter Tools' });
            notify('Service', { kind: 'ServiceRegistered', service: 'hotRestart', method: 's0.hotRestart', alias: 'Flutter Tools' });
          }
          if (req.params.streamId === 'Extension') {
            notify('Extension', { extensionKind: 'Flutter.Error', extensionData: { renderedError: 'RenderFlex overflowed by 12 pixels' } });
          }
          break;
        case 'getVM':
          reply({ isolates: [{ id: 'isolates/helper', name: 'bg' }, { id: currentIsolate, name: 'main' }] });
          break;
        case 'getIsolate':
          reply({ id: req.params.isolateId, extensionRPCs: req.params.isolateId === currentIsolate ? ['ext.flutter.reassemble', 'ext.flutter.inspector.getRootWidgetSummaryTree'] : [] });
          break;
        case 's0.reloadSources':
          if (!checkIsolate()) { fail(-32000, 'Sentinel: isolate collected'); break; }
          reply({ type: 'Success' });
          break;
        case 's0.hotRestart':
          if (!checkIsolate()) { fail(-32000, 'Sentinel: isolate collected'); break; }
          isolateCounter++;
          currentIsolate = `isolates/${isolateCounter}`;
          notify('Isolate', { kind: 'IsolateExit', isolate: { id: `isolates/${isolateCounter - 1}` } });
          reply({ type: 'Success' });
          break;
        case 'ext.flutter.inspector.getRootWidgetSummaryTree':
          if (!checkIsolate()) { fail(-32000, 'Sentinel: isolate collected'); break; }
          reply({ result: { description: 'MyApp', children: [] } });
          break;
        case 'ext.flutter.inspector.disposeGroup':
          reply({ type: 'Success' });
          break;
        case 'ext.flutter.driver': {
          if (!driver) { fail(-32601, 'Method not found'); break; }
          const p = req.params;
          if (p.command === 'tap' && p.finderType === 'ByText' && p.text === 'Login') { reply({ isError: false, response: { finished: true } }); break; }
          if (p.command === 'tap' && p.finderType === 'ByValueKey' && p.keyValueString === 'loginButton') { reply({ isError: false, response: { finished: true } }); break; }
          if (p.command === 'tap') { reply({ isError: true, response: { message: 'Timed out waiting for the finder' } }); break; }
          if (p.command === 'enter_text' || p.command === 'set_text_entry_emulation' || p.command === 'scroll') { reply({ isError: false, response: {} }); break; }
          fail(-32601, 'Method not found');
          break;
        }
        default:
          fail(-32601, 'Method not found');
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });

  const port = (wss.address() as AddressInfo).port;
  return {
    uri: `http://127.0.0.1:${port}/abc=/`,
    log,
    closeClients: () => sockets.forEach(s => s.terminate()),
    stop: () => new Promise<void>(res => { sockets.forEach(s => s.terminate()); wss.close(() => res()); }),
  };
}

test('hot reload goes through the registered reloadSources service with the right isolate', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.');
  try {
    const r = await bridge.hotReload(mock.uri);
    assert.equal(r.success, true, r.message);
    const call = mock.log.find(l => l.method === 's0.reloadSources');
    assert.ok(call, 'the namespaced service method was called');
    assert.equal(call!.params.isolateId, 'isolates/1', 'the Flutter isolate (not the helper isolate) was chosen');
    assert.ok(!mock.log.some(l => l.method === 'ext.flutter.reassemble'), 'reassemble alone is not used as "hot reload"');
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('hot reload reports failure honestly when the Flutter tool service is not registered', async () => {
  const mock = startMock({ registerServices: false });
  const bridge = new VmServiceBridge('.');
  try {
    const r = await bridge.hotReload(mock.uri);
    assert.equal(r.success, false);
    assert.match(r.message, /reloadSources/);
    assert.match(r.message, /does not load changed code/);
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('after a hot restart the new isolate is used (stale isolate id bug)', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.');
  try {
    const restart = await bridge.hotRestart(mock.uri);
    assert.equal(restart.success, true, restart.message);
    const inspect = await bridge.inspectLiveWidgets(mock.uri);
    assert.equal(inspect.success, true, inspect.message);
    assert.equal(inspect.isolateId, 'isolates/2');
    const reload = await bridge.hotReload(mock.uri);
    assert.equal(reload.success, true, reload.message);
    assert.equal(mock.log.filter(l => l.method === 's0.reloadSources').pop()!.params.isolateId, 'isolates/2');
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('runtime errors are collected from the Extension stream', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.');
  try {
    const r = await bridge.getRuntimeErrors(mock.uri);
    await new Promise(res => setTimeout(res, 100));
    const again = await bridge.getRuntimeErrors(mock.uri);
    assert.ok(r.status.length > 0);
    assert.equal(again.count, 1);
    assert.match(again.errors[0].message, /RenderFlex overflowed/);
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('tap: succeeds only when Flutter Driver confirms; bare string tries key then text', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.');
  try {
    const byKey = await bridge.simulateUiAction('tap', 'loginButton', undefined, mock.uri);
    assert.equal(byKey.success, true);
    assert.equal(byKey.performed, true);
    const byText = await bridge.simulateUiAction('tap', 'Login', undefined, mock.uri);
    assert.equal(byText.success, true);
    assert.match(byText.message, /ByText/);
    const missing = await bridge.simulateUiAction('tap', 'key:doesNotExist', undefined, mock.uri);
    assert.equal(missing.success, false);
    assert.match(missing.message, /Timed out/);
    const typed = await bridge.simulateUiAction('enterText', 'text:Login', 'hello', mock.uri);
    assert.equal(typed.success, true);
    assert.ok(mock.log.some(l => l.method === 'ext.flutter.driver' && l.params.command === 'enter_text' && l.params.text === 'hello'));
    // every driver param must be a string
    for (const l of mock.log.filter(x => x.method === 'ext.flutter.driver')) {
      for (const [k, v] of Object.entries(l.params)) { assert.equal(typeof v, 'string', `${k} must be a string`); }
    }
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('without the driver extension nothing is reported as done (old code claimed success via inspector selection)', async () => {
  const mock = startMock({ driver: false });
  const bridge = new VmServiceBridge('.');
  try {
    const r = await bridge.simulateUiAction('tap', 'key:x', undefined, mock.uri);
    assert.equal(r.success, false);
    assert.equal(r.performed, false);
    assert.match(r.message, /enableFlutterDriverExtension/);
    assert.ok(!mock.log.some(l => l.method === 'ext.flutter.inspector.setSelectionById'));
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('a dropped connection rejects pending calls and a later call reconnects', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.');
  try {
    assert.equal((await bridge.hotReload(mock.uri)).success, true);
    mock.closeClients();
    await new Promise(res => setTimeout(res, 100));
    const again = await bridge.hotReload(mock.uri);
    assert.equal(again.success, true, again.message);
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('connect failure is reported quickly', async () => {
  const bridge = new VmServiceBridge('.');
  const t0 = Date.now();
  const r = await bridge.connect('http://127.0.0.1:1/nope=/');
  assert.equal(r.success, false);
  assert.ok(Date.now() - t0 < 6000);
});

test('idle disconnect releases the socket', async () => {
  const mock = startMock();
  const bridge = new VmServiceBridge('.', { idleDisconnectMs: 150 });
  try {
    await bridge.connect(mock.uri);
    await new Promise(res => setTimeout(res, 400));
    assert.equal((bridge as any).ws, null);
  } finally { bridge.disconnect(); await mock.stop(); }
});

test('no VM service URI => helpful message', async () => {
  delete process.env.DART_VM_SERVICE_URI;
  const bridge = new VmServiceBridge('/definitely/not/a/project');
  const r = await bridge.connect();
  assert.equal(r.success, false);
  assert.match(r.message, /flutter run/);
});
