import assert from 'node:assert/strict';
import ts from 'typescript';
import { deadline, waitForObserved } from './native-hmr-support.mjs';

function unwrap(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function chunkLists(node) {
  node = unwrap(node);
  return (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'globalThis' &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === 'TURBOPACK_CHUNK_LISTS'
  );
}

function producerReceiver(node) {
  node = unwrap(node);
  if (chunkLists(node)) return true;
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.BarBarToken)
    return false;
  const right = unwrap(node.right);
  return (
    chunkLists(node.left) &&
    ts.isBinaryExpression(right) &&
    right.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    chunkLists(right.left) &&
    ts.isArrayLiteralExpression(right.right) &&
    right.right.elements.length === 0
  );
}

function executingScript(node) {
  if (!node || !ts.isConditionalExpression(node)) return false;
  const current = node.whenTrue;
  return (
    ts.isPropertyAccessExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === 'document' &&
    current.name.text === 'currentScript' &&
    ts.isIdentifier(node.whenFalse) &&
    node.whenFalse.text === 'undefined'
  );
}

function entryMetadata(node) {
  assert.equal(node.arguments.length, 1, 'Unexpected chunk-list producer arguments');
  const object = node.arguments[0];
  assert(ts.isObjectLiteralExpression(object), 'Chunk-list metadata must be literal');
  const fields = new Map(
    object.properties.map((property) => {
      assert(ts.isPropertyAssignment(property), 'Unsupported chunk-list metadata property');
      return [property.name.text, property.initializer];
    }),
  );
  assert.equal(fields.size, object.properties.length, 'Duplicate chunk-list metadata property');
  const kind = fields.get('source');
  assert(kind && ts.isStringLiteral(kind), 'Missing chunk-list source');
  if (kind.text !== 'entry') return false;
  const chunks = fields.get('chunks');
  assert(chunks && ts.isArrayLiteralExpression(chunks), 'Missing initial chunks');
  assert(chunks.elements.every(ts.isStringLiteral), 'Initial chunks must be literal paths');
  assert(
    executingScript(fields.get('script')),
    'Initial chunk-list must identify its executing script',
  );
  return true;
}

export function entryProducer(text) {
  if (!text.includes('TURBOPACK_CHUNK_LISTS')) return false;
  assert(Buffer.byteLength(text) <= 4 * 1024 * 1024, 'Chunk-list producer exceeds parser bound');
  const source = ts.createSourceFile(
    'producer.js',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(source.parseDiagnostics.length, 0, 'Malformed chunk-list JavaScript');
  let entries = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'push' &&
      producerReceiver(node.expression.expression)
    ) {
      if (entryMetadata(node)) entries++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(entries <= 1, 'Multiple entry producers in one script');
  return entries === 1;
}

export function trackInitialScripts(state, observed) {
  const scripts = new Map();
  state.initialScripts = scripts;
  state.cdp.on('Network.requestWillBeSent', (data) => {
    if (data.type === 'Script')
      scripts.set(data.requestId, {
        requestId: data.requestId,
        url: data.request.url,
        loaderId: data.loaderId,
        frameId: data.frameId,
        complete: false,
      });
  });
  state.cdp.on('Network.loadingFinished', ({ requestId }) => {
    const script = scripts.get(requestId);
    if (script) script.complete = true;
    observed.emit('event');
  });
  state.cdp.on('Network.loadingFailed', ({ requestId, errorText }) => {
    const script = scripts.get(requestId);
    if (script) script.error = errorText;
    observed.emit('event');
  });
}

const javascriptTypes = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

function executableScriptSource(attributes) {
  const fields = new Map();
  for (let index = 0; index < attributes.length; index += 2)
    fields.set(attributes[index], attributes[index + 1]);
  const type = fields.has('type')
    ? fields
        .get('type')
        .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')
        .toLowerCase()
    : fields.get('language')
      ? `text/${fields.get('language').toLowerCase()}`
      : '';
  if (type === 'module') return fields.get('src');
  // Chromium supports modules; nomodule suppresses classic scripts only.
  if (fields.has('nomodule')) return null;
  return type === '' || javascriptTypes.has(type) ? fields.get('src') : null;
}

async function documentScripts(cdp) {
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: 'script[src]',
  });
  assert(nodeIds.length > 0 && nodeIds.length <= 256, 'Unexpected document script inventory size');
  const sources = await Promise.all(
    nodeIds.map(async (nodeId) => {
      const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
      return executableScriptSource(attributes);
    }),
  );
  return sources.filter((src) => src !== null);
}

export async function initialInventory(state, observed, remaining) {
  const { cdp, page } = state;
  await page.waitForLoadState('load', { timeout: remaining() });
  const frame = (await deadline(cdp.send('Page.getFrameTree'), remaining(), 'Initial frame'))
    .frameTree.frame;
  const urls = (await deadline(documentScripts(cdp), remaining(), 'Document scripts')).map(
    (src) => new URL(src, frame.url).href,
  );
  const scripts = [...state.initialScripts.values()].filter(
    (script) => script.loaderId === frame.loaderId && script.frameId === frame.id,
  );
  assert(scripts.length <= 256, 'Initial script request inventory exceeds bound');
  for (const url of urls)
    assert(
      scripts.some((script) => script.url === url),
      `Missing script request: ${url}`,
    );
  await waitForObserved(
    observed,
    () => scripts.every((script) => script.complete || script.error),
    remaining(),
    'Initial script completion',
  );
  const resources = [];
  let bodyBytes = 0;
  for (const script of scripts) {
    assert(!script.error, `Initial script failed: ${script.url}: ${script.error}`);
    const response = await deadline(
      cdp.send('Network.getResponseBody', { requestId: script.requestId }),
      remaining(),
      'Initial producer body',
    );
    const body = Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8').toString(
      'utf8',
    );
    bodyBytes += Buffer.byteLength(body);
    assert(bodyBytes <= 32 * 1024 * 1024, 'Initial script bodies exceed inventory bound');
    if (!entryProducer(body)) continue;
    const url = new URL(script.url);
    assert.equal(url.origin, new URL(frame.url).origin, 'Cross-origin initial producer');
    assert(url.pathname.startsWith('/_next/'), 'Unexpected initial producer URL');
    resources.push({ path: decodeURI(url.pathname.slice('/_next/'.length)), headers: null });
  }
  assert(resources.length > 0, 'No emitted initial entry chunk-list producers');
  const after = (await deadline(cdp.send('Page.getFrameTree'), remaining(), 'Sealed frame'))
    .frameTree.frame;
  assert.equal(after.loaderId, frame.loaderId, 'Document changed while sealing producers');
  return { loaderId: frame.loaderId, documentUrl: frame.url, scripts, resources };
}
