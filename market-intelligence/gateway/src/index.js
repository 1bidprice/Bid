import { handleMarketGatewayRequest } from './core.js';

export default {
  async fetch(request, env) {
    return handleMarketGatewayRequest(request, env);
  },
};
