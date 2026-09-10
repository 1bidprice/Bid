import { handleMarketGatewayEdgeRequest } from './edge.js';

export default {
  async fetch(request, env, ctx) {
    return handleMarketGatewayEdgeRequest(request, env, ctx);
  },
};
