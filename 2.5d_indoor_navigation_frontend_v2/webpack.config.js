const path = require('path');
const fs = require('fs');
const os = require('os');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const ifaces of Object.values(nets)) {
    if (!ifaces) continue;
    for (const net of ifaces) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: './src/main.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? 'bundle.js' : 'bundle.[contenthash:8].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js', '.json'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.scss$/,
          use: [
            isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
            'css-loader',
            'sass-loader',
          ],
        },
        {
          test: /\.css$/,
          use: [
            isDev ? 'style-loader' : MiniCssExtractPlugin.loader,
            'css-loader',
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/index.html',
      }),
      new MiniCssExtractPlugin({
        filename: 'style.[contenthash:8].css',
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'public/geojson', to: 'geojson' },
          { from: 'public/strings', to: 'strings' },
          { from: 'public/images', to: 'images', noErrorOnMissing: true },
        ],
      }),
    ],
    devServer: {
      static: [
        { directory: path.join(__dirname, 'public'), watch: false },
        { directory: path.join(__dirname, 'videos'), publicPath: '/videos', watch: false },
      ],
      headers: { 'Access-Control-Allow-Origin': '*' },
      host: '0.0.0.0',           // bind all interfaces so phones on LAN can connect
      allowedHosts: 'all',       // accept Host: <lan-ip> without "Invalid Host header"
      port: 8082,
      hot: true,
      liveReload: true,
      open: true,
      watchFiles: ['src/**/*', 'scss/**/*', 'public/index.html'],
      client: {
        overlay: false,                           // disable error overlay blocking clicks
        webSocketURL: 'auto://0.0.0.0:0/ws',     // HMR reconnects from LAN
      },
      // Proxy the backend Spring Boot endpoints so the browser sees them as
      // same-origin. Required for mobile testing over LAN IPs (otherwise the
      // backend's CORS allowlist rejects the cross-origin request).
      // The three /api/save-* paths are NOT listed here — they're served by
      // the local PUT handlers in setupMiddlewares (file writes to public/).
      proxy: [
        {
          context: [
            '/api/route',
            '/api/graph',
            '/api/geojson',
            '/api/rooms',
            '/api/nodes',
            '/api/edges',
            '/api/buildings',
          ],
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      ],
      setupMiddlewares(middlewares, devServer) {
        const jsonParser = require('express').json({ limit: '10mb' });

        // Recursive video lookup — any file under videos/ (at any depth) is
        // served as /videos/<filename>. The frontend uses flat URLs but we
        // want to allow organizing the videos/ folder into subdirectories
        // (per building, per recording date, etc.).
        //
        // Builds a filename → absolute-path index lazily; refreshes on miss
        // so newly dropped files are picked up without restarting the server.
        const VIDEOS_ROOT = path.join(__dirname, 'videos');
        let videoIndex = null;   // Map<filename, absPath> | null

        function buildVideoIndex() {
          const map = new Map();
          if (!fs.existsSync(VIDEOS_ROOT)) return map;
          const stack = [VIDEOS_ROOT];
          while (stack.length) {
            const dir = stack.pop();
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) stack.push(full);
              else if (entry.isFile()) {
                if (!map.has(entry.name)) map.set(entry.name, full);
              }
            }
          }
          return map;
        }

        function resolveVideo(filename) {
          if (!videoIndex) videoIndex = buildVideoIndex();
          let abs = videoIndex.get(filename);
          if (abs && fs.existsSync(abs)) return abs;
          // Miss or stale — rebuild and try once more.
          videoIndex = buildVideoIndex();
          abs = videoIndex.get(filename);
          return abs && fs.existsSync(abs) ? abs : null;
        }

        // Register video routes at the FRONT of the middleware chain so they
        // run before webpack-dev-server's static/proxy/fallback middleware.
        // (webpack-dev-server v5 deprecated devServer.app for this case —
        // unshifting onto `middlewares` is the supported path.)
        middlewares.unshift({
          name: 'api-videos-list',
          path: '/api/videos-list',
          middleware: (req, res, next) => {
            if (req.method !== 'GET') return next();
            videoIndex = buildVideoIndex();
            const files = Array.from(videoIndex.keys())
              .filter((n) => n.toLowerCase().endsWith('.mp4'))
              .sort();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ files }));
          },
        });

        middlewares.unshift({
          name: 'videos-recursive',
          path: '/videos',
          middleware: (req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            // req.url here is relative to the mount path '/videos' — e.g. '/foo.mp4'
            const filename = decodeURIComponent(req.url.replace(/^\/+/, '').split('?')[0]);
            if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
              return next();
            }
            const abs = resolveVideo(filename);
            if (!abs) return next();
            res.sendFile(abs, (err) => {
              if (err && !res.headersSent) next(err);
            });
          },
        });

        // Log reachable URLs for phone-on-LAN testing
        const lanAddrs = getLanAddresses();
        if (lanAddrs.length > 0) {
          console.log('\n  📱 Mobile testing — open on phone over Wi-Fi:');
          for (const addr of lanAddrs) {
            console.log(`     http://${addr}:8082            (auto device detect)`);
            console.log(`     http://${addr}:8082?device=mobile (force mobile UI)`);
          }
          console.log('');
        }

        // PUT /api/save-graph → write to public/geojson/graph.json
        devServer.app.put('/api/save-graph', jsonParser, (req, res) => {
          const filePath = path.join(__dirname, 'public', 'geojson', 'graph.json');
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
          res.json({ ok: true });
        });

        // PUT /api/save-video-settings → write to public/geojson/video_settings.json
        devServer.app.put('/api/save-video-settings', jsonParser, (req, res) => {
          const filePath = path.join(__dirname, 'public', 'geojson', 'video_settings.json');
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
          res.json({ ok: true });
        });

        // PUT /api/save-rooms/:building/:level → public/geojson/{building}/{building}_room_L{level}.geojson
        // Level can be negative (basements: -1 = B1).
        devServer.app.put('/api/save-rooms/:building/:level', jsonParser, (req, res) => {
          const building = String(req.params.building);
          const level = parseInt(req.params.level, 10);
          if (!/^[a-z][a-z0-9_-]*$/i.test(building)) {
            return res.status(400).json({ error: 'invalid building code' });
          }
          if (!Number.isInteger(level) || level === 0 || level < -5 || level > 20) {
            return res.status(400).json({ error: 'invalid level' });
          }
          const filePath = path.join(
            __dirname, 'public', 'geojson', building,
            `${building}_room_L${level}.geojson`,
          );
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
          res.json({ ok: true });
        });

        // Back-compat: legacy /api/save-rooms/:level → defaults to eng1.
        devServer.app.put('/api/save-rooms/:level', jsonParser, (req, res) => {
          const level = parseInt(req.params.level, 10);
          if (!Number.isInteger(level) || level < 1 || level > 10) {
            return res.status(400).json({ error: 'invalid level' });
          }
          const filePath = path.join(__dirname, 'public', 'geojson', 'eng1', `eng1_room_L${level}.geojson`);
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
          res.json({ ok: true });
        });
        return middlewares;
      },
    },
    devtool: isDev ? 'eval-source-map' : 'source-map',
  };
};
