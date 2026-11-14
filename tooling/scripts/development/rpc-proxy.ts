import type { ProxyOptions } from 'vite-plus';

/** Same-origin browser transport for the canonical native RPC endpoint. */
export function studyRpcProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/auth/callback': { target },
    '/rpc': {
      target,
      ws: true,
      configure: (proxy) => {
        proxy.on('proxyReq', (request) => request.removeHeader('origin'));
        proxy.on('proxyReqWs', (request, incoming, socket) => {
          const origin = incoming.headers.origin;

          if (origin && !sameOrigin(origin, incoming.headers.host)) {
            request.destroy();
            socket.destroy();

            return;
          }

          request.removeHeader('origin');
        });
      }
    }
  };
}

function sameOrigin(origin: string, host: string | undefined): boolean {
  try {
    const url = new URL(origin);

    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === host;
  } catch {
    return false;
  }
}
