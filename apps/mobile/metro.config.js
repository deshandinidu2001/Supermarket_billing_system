const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const config = getDefaultConfig(__dirname);
// Expo development server only: same-origin browser preview to the local API.
// The production API continues to reject browser-origin requests.
const http = require('node:http');
const enhance = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const next = enhance ? enhance(middleware, server) : middleware;
  return (req, res, done) => {
    if (!req.url?.startsWith('/api/')) return next(req, res, done);
    if (
      !['localhost:8082', '127.0.0.1:8082'].includes(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    ) {
      res.writeHead(403);
      res.end('Use the local browser preview.');
      return;
    }
    const headers = { ...req.headers, host: '127.0.0.1:4311' };
    delete headers.origin;
    const upstream = http.request(
      { hostname: '127.0.0.1', port: 4311, path: req.url, method: req.method, headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Start the local analytics API on port 4311.' }));
    });
    req.pipe(upstream);
  };
};
config.watchFolders = [
  path.resolve(__dirname, '../../packages'),
  path.resolve(__dirname, '../../shared'),
];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];
module.exports = config;
