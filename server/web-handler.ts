import serverless from 'serverless-http';
import type { Express } from 'express';

type GatewayResponse = {
  statusCode: number;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
};
export function webHandler(app: Express) {
  const handle = serverless(app, { binary: true });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers);
    // Only the platform's request URL supplies Host; forwarding headers from callers
    // must not choose the public origin or manufacture a trusted client address.
    for (const key of ['x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto'])
      delete headers[key];
    headers.host = url.host;
    headers['x-forwarded-proto'] = url.protocol.slice(0, -1);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (request.body) {
      const reader = request.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return Response.json({ message: 'Слишком большой запрос' }, { status: 413 });
        }
        chunks.push(value);
      }
    }
    const result = (await handle(
      {
        version: '2.0',
        rawPath: url.pathname,
        rawQueryString: url.search.slice(1),
        headers,
        requestContext: {
          http: {
            method: request.method,
            path: url.pathname,
            protocol: 'HTTP/1.1',
            sourceIp: '127.0.0.1',
          },
        },
        body: Buffer.concat(chunks).toString('base64'),
        isBase64Encoded: true,
      },
      {},
    )) as GatewayResponse;
    const responseHeaders = new Headers(result.headers);
    for (const cookie of result.cookies || []) responseHeaders.append('Set-Cookie', cookie);
    const body =
      request.method === 'HEAD' || [204, 304].includes(result.statusCode)
        ? null
        : result.isBase64Encoded
          ? Buffer.from(result.body || '', 'base64')
          : result.body || '';
    return new Response(body, { status: result.statusCode, headers: responseHeaders });
  };
}
