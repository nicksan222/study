import type { ProxyOptions } from 'vite-plus';

/** Same-origin browser transport for the canonical native RPC endpoint. */
export function studyRpcProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/auth/callback': { target },
    '/rpc': {
      target,
      configure: (proxy) => {
        proxy.on('proxyReq', (request) => request.removeHeader('origin'));
      }
    }
  };
}
