const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  // Proxy all API calls to the Cockpit server
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8000',
      changeOrigin: true,
    }),
  );

  // Proxy WebSocket for ASR dictation
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'http://localhost:8000',
      changeOrigin: true,
      ws: true,
    }),
  );

  // Proxy config (templates, ASR lists)
  app.use(
    '/config',
    createProxyMiddleware({
      target: 'http://localhost:8000',
      changeOrigin: true,
    }),
  );
};
