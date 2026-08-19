// Vercel Node.js serverless function that hands every non-static request to
// the TanStack Start SSR bundle. Static assets in dist/client are served by
// Vercel directly (see vercel.json rewrites which exclude /assets, favicon, etc.).
// We use the Node runtime (not Edge) because the SSR bundle imports
// `node:async_hooks`.
import server from "../dist/server/server.js";

// Convert a Node IncomingMessage to a Web Fetch Request, forward it to the
// TanStack Start server, and stream the Response back through the Node
// ServerResponse.
export default async function handler(req, res) {
  const url = new URL(req.url ?? "/", `https://${req.headers.host}`);

  // Read the body if there is one.
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
    else headers.set(k, v);
  }

  const request = new Request(url, { method: req.method, headers, body });
  const response = await server.fetch(request);

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    // Node lowercases headers automatically; set them one by one.
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}
