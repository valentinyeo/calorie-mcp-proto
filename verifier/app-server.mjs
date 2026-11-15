// One local static server for every checkout running on this machine. The web app is
// served under http://localhost:5173/<slug>/, so both checkouts share the single origin the
// Worker trusts (APP_ORIGINS in src/auth.ts) and the app's real CORS rules stay in force.
// Mounts come from $PSTACK_MOUNTS (default /tmp/pstack-app-mounts): one <slug>.json file
// per checkout, written by start-app.sh. Read on every request, so a later mount appears
// without a restart. Local only, no dependency, nothing to install.
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const PORT = Number(process.argv[2] ?? 5173);
const HOST = process.argv[3] ?? "127.0.0.1";
const MOUNTS = process.env.PSTACK_MOUNTS ?? "/tmp/pstack-app-mounts";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function mounts() {
  const found = new Map();
  let entries = [];
  try {
    entries = readdirSync(MOUNTS);
  } catch {
    return found;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const mount = JSON.parse(readFileSync(join(MOUNTS, name), "utf8"));
      if (typeof mount.slug === "string" && typeof mount.dir === "string") {
        found.set(mount.slug, mount.dir);
      }
    } catch {
      // A half-written mount file is not an error; the next request picks it up.
    }
  }
  return found;
}

const reply = (response, status, body, type = "text/plain; charset=utf-8") => {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/__pstack") {
    return reply(response, 200, JSON.stringify([...mounts().keys()]), "application/json");
  }

  const [, slug, ...rest] = url.pathname.split("/");
  const dir = mounts().get(slug);
  if (dir === undefined) {
    return reply(response, 404, `no app mounted at /${slug ?? ""}\n`);
  }

  const wanted = normalize(join("/", rest.join("/")));
  const file = join(dir, wanted);
  if (!file.startsWith(dir + sep) && file !== join(dir, "index.html")) {
    return reply(response, 403, "outside the bundle\n");
  }

  const send = (path) => {
    response.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(path).pipe(response);
  };

  try {
    if (statSync(file).isFile()) return send(file);
  } catch {
    // fall through to index.html, the bundle is a single page
  }
  try {
    if (statSync(join(dir, "index.html")).isFile()) return send(join(dir, "index.html"));
  } catch {
    return reply(response, 404, "the bundle is missing index.html\n");
  }
  return reply(response, 404, "not found\n");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    // Another checkout already started the shared server. Its mounts directory is shared,
    // so this checkout only needed its mount file, which start-app.sh wrote already.
    process.stderr.write(`app-server: port ${PORT} is already served by another checkout\n`);
    process.exit(0);
  }
  process.stderr.write(`app-server: ${error.message}\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`app-server: http://localhost:${PORT}/ (mounts in ${MOUNTS})\n`);
});
