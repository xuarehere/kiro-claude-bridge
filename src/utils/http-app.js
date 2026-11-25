import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackAddress(remoteAddress) {
  if (!remoteAddress) return true;
  return LOOPBACK_ADDRS.has(remoteAddress);
}

/**
 * Create a lightweight, zero-dependency static file middleware.
 */
export function serveStatic(rootDir) {
  const resolvedRoot = path.resolve(rootDir);

  return function staticMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const reqPath = req.path === '/' ? '/index.html' : req.path;
    const safeRel = path.normalize(reqPath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(resolvedRoot, safeRel);

    // Prevent directory traversal outside static root
    if (!filePath.startsWith(resolvedRoot + path.sep) && filePath !== resolvedRoot) {
      return next();
    }

    try {
      if (!fs.existsSync(filePath)) return next();
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return next();

      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);

      if (req.method === 'HEAD') {
        res.statusCode = 200;
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => next(err));
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Create JSON body parser middleware with configurable byte limit.
 */
export function jsonBodyParser({ limitBytes = 15 * 1024 * 1024 } = {}) {
  return function parseJsonMiddleware(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    if (req.body !== undefined) return next();

    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      req.body = {};
      return next();
    }

    const chunks = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > limitBytes) {
        aborted = true;
        res.status(413).json({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'Request body too large' },
        });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        req.body = {};
        return next();
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        req.body = {};
        return next();
      }
      try {
        req.body = JSON.parse(raw);
        next();
      } catch (err) {
        res.status(400).json({
          type: 'error',
          error: { type: 'invalid_request_error', message: `Invalid JSON body: ${err.message}` },
        });
      }
    });

    req.on('error', (err) => {
      if (!aborted) next(err);
    });
  };
}

/**
 * Zero-dependency Express-compatible HTTP router over native node:http.
 */
export function createHttpApp({ loopbackOnly = true, enableCors = true } = {}) {
  const layers = [];

  function enhanceRes(res) {
    res.status = function status(code) {
      res.statusCode = code;
      return res;
    };
    res.json = function json(payload) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(payload));
      return res;
    };
    return res;
  }

  const app = function requestHandler(req, res) {
    enhanceRes(res);

    if (loopbackOnly && !isLoopbackAddress(req.socket?.remoteAddress)) {
      res.status(403).json({ error: 'Forbidden: loopback access only' });
      return;
    }

    if (enableCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }

    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    req.path = parsedUrl.pathname;
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());

    let idx = 0;

    function next(err) {
      if (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message || 'Internal Server Error' });
        } else {
          res.end();
        }
        return;
      }

      // Re-sync req.path if an earlier middleware rewrote req.url (e.g. /claude-desktop prefix stripping)
      const currentParsed = new URL(req.url || '/', 'http://localhost');
      req.path = currentParsed.pathname;

      while (idx < layers.length) {
        const layer = layers[idx++];
        if (layer.method === null || layer.method === req.method) {
          if (layer.routePath === null || layer.routePath === req.path) {
            try {
              const maybePromise = layer.handler(req, res, next);
              if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch(next);
              }
            } catch (syncErr) {
              next(syncErr);
            }
            return;
          }
        }
      }

      if (!res.writableEnded) {
        res.status(404).json({
          type: 'error',
          error: { type: 'not_found_error', message: `Not found: ${req.method} ${req.path}` },
        });
      }
    }

    next();
  };

  app.use = (fn) => {
    layers.push({ method: null, routePath: null, handler: fn });
    return app;
  };
  app.get = (routePath, fn) => {
    layers.push({ method: 'GET', routePath, handler: fn });
    return app;
  };
  app.post = (routePath, fn) => {
    layers.push({ method: 'POST', routePath, handler: fn });
    return app;
  };
  app.head = (routePath, fn) => {
    layers.push({ method: 'HEAD', routePath, handler: fn });
    return app;
  };
  app.options = (routePath, fn) => {
    layers.push({ method: 'OPTIONS', routePath, handler: fn });
    return app;
  };

  app.listen = (port, hostOrCb, cb) => {
    const server = http.createServer(app);
    if (typeof hostOrCb === 'function') {
      return server.listen(port, hostOrCb);
    }
    return server.listen(port, hostOrCb, cb);
  };

  return app;
}
