import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const BODY_LIMIT = 1_000_000;

/** Fetch forbids these on a Request constructed from an incoming Node message. */
const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface NodeServer {
  port: number;
  close(): Promise<void>;
}

/** Node HTTP adapter. The request handler is the same function the Worker calls. */
export function startNodeServer(options: {
  host: string;
  port: number;
  handler: (request: Request) => Promise<Response>;
}): Promise<NodeServer> {
  const server = createServer((req, res) => {
    void serve(req, res, options.handler).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: "request_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      }
      res.end("Internal error");
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  handler: (request: Request) => Promise<Response>,
): Promise<void> {
  const method = req.method ?? "GET";
  const pathAndQuery = req.url ?? "/";
  const hostHeader = req.headers.host;
  const host = typeof hostHeader === "string" && hostHeader.length > 0 ? hostHeader : "127.0.0.1";
  let requestUrl: URL;
  try {
    requestUrl = new URL(pathAndQuery, `http://${host}`);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Bad request");
    return;
  }

  if (!isProbe(method, requestUrl.pathname)) {
    console.log(JSON.stringify({ message: "request", method, path: requestUrl.pathname }));
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const read = await readBody(req, BODY_LIMIT);
    if (read === "too_large") {
      res.writeHead(413, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end("Payload too large");
      return;
    }
    body = read;
  }

  const response = await handler(
    new Request(requestUrl, {
      method,
      headers: headersFromNode(req),
      body,
    }),
  );
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function isProbe(method: string, pathname: string): boolean {
  return method === "GET" && (pathname === "/health" || pathname === "/healthz" || pathname === "/readyz");
}

function headersFromNode(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key)) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | "too_large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: Buffer | "too_large" | Error): void => {
      if (settled) return;
      settled = true;
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        finish("too_large");
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", (error: Error) => {
      if (size > limit) finish("too_large");
      else finish(error);
    });
  });
}
