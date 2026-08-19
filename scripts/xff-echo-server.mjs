// The backend for `compose.xff-test.yaml` (#113): a minimal, dependency-free
// HTTP server that echoes every request header back as JSON, so
// `src/lib/server/auth/caddy-xff.test.ts` can inspect exactly what Caddy's
// `reverse_proxy` (`deploy/Caddyfile`, the same file the production stack
// runs) forwarded for `X-Forwarded-For` — including whatever a client tried
// to set on that header itself. Plain Node `http`, no dependencies, so the
// `node:24-alpine` image in the compose file needs nothing installed.
//
// Deliberately still `console.log`, not `$lib/server/log/logger` (#317):
// `compose.xff-test.yaml` bind-mounts this one file alone into the
// container (`./scripts/xff-echo-server.mjs:/app/xff-echo-server.mjs:ro`),
// so nothing else in the repository — the logging module included — is
// on disk there for an import to resolve.
import { createServer } from 'node:http';

const server = createServer((req, res) => {
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify({ headers: req.headers }));
});

server.listen(3000, () => {
	console.log('xff-echo-server listening on 3000');
});
