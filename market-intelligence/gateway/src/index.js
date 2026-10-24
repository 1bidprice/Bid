import { handleMarketGatewayEdgeRequest } from './edge.js';
import { runRemoteAlertCycle } from './remote-alert-scheduler.js';

export default {
  async fetch(request, env, ctx) {
    return handleMarketGatewayEdgeRequest(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    const run = runRemoteAlertCycle(env, { now: controller?.scheduledTime || Date.now() });
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(run);
      return;
    }
    await run;
  },
};
