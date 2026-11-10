import { deadline } from './native-hmr-support.mjs';

export function observeNavigation(state, record) {
  let active = false;
  let omittedRequests = 0;
  const requests = new Map();
  const { cdp, label } = state;
  cdp.on('Network.requestWillBeSent', (data) => {
    if (!active) return;
    const url = new URL(data.request.url);
    if (data.type !== 'Script' && !url.searchParams.has('_rsc')) return;
    if (requests.size >= 256) {
      omittedRequests++;
      return;
    }
    requests.set(data.requestId, {
      requestId: data.requestId,
      url: data.request.url,
      type: data.type,
      requestTimestamp: data.timestamp,
      loaderId: data.loaderId,
      packets: 0,
      dataLength: 0,
      encodedDataLength: 0,
    });
  });
  cdp.on('Network.responseReceived', (data) => {
    const request = requests.get(data.requestId);
    if (!request) return;
    request.response = {
      timestamp: data.timestamp,
      status: data.response.status,
      timing: data.response.timing,
      protocol: data.response.protocol,
      fromDiskCache: data.response.fromDiskCache,
    };
  });
  cdp.on('Network.dataReceived', (data) => {
    const request = requests.get(data.requestId);
    if (!request) return;
    request.firstDataTimestamp ??= data.timestamp;
    request.lastDataTimestamp = data.timestamp;
    request.packets++;
    request.dataLength += data.dataLength;
    request.encodedDataLength += data.encodedDataLength;
  });
  for (const event of ['Network.loadingFinished', 'Network.loadingFailed']) {
    cdp.on(event, (data) => {
      const request = requests.get(data.requestId);
      if (request) request.completion = { event, ...data };
    });
  }
  const snapshot = async (stage) => {
    try {
      const metrics = await deadline(
        cdp.send('Performance.getMetrics'),
        1000,
        'Performance snapshot',
      );
      record('public-create-performance', { stage, ...metrics }, label);
    } catch (error) {
      record('public-create-observation-error', { stage, message: error.message }, label);
    }
  };
  return {
    async begin() {
      await snapshot('before');
      active = true;
    },
    async end() {
      active = false;
      record('public-create-outcome', {}, label);
      await snapshot('after');
      record('public-create-network', { requests: [...requests.values()], omittedRequests }, label);
      requests.clear();
    },
  };
}
