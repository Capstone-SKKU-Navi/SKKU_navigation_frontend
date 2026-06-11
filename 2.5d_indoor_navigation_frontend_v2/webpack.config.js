const path = require('path');
const fs = require('fs');
const os = require('os');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

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
  const isProdBuild = process.env.PROD_BUILD === 'true';
  const apiBaseUrl = process.env.API_BASE_URL || '';
  const videoBaseUrl = process.env.VIDEO_BASE_URL || '';
  const defaultFeedbackFormUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfZmbjBazwcqqBCN88k5Gt9NO_NBOSaToD1s7lU3hNkRd4WRQ/viewform';
  const feedbackFormUrl = process.env.FEEDBACK_FORM_URL || defaultFeedbackFormUrl;
  const feedbackEntryType = process.env.FEEDBACK_ENTRY_TYPE || 'entry.535998606';
  const feedbackEntryTarget = process.env.FEEDBACK_ENTRY_TARGET || 'entry.307290085';
  const feedbackEntryDebug = process.env.FEEDBACK_ENTRY_DEBUG || 'entry.1498754538';
  const feedbackEntryScreenshotReportId = process.env.FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID || 'entry.2038317800';
  const defaultFeedbackScreenshotUploadUrl = 'https://script.google.com/macros/s/AKfycbwkOjTmvO_0CEHmfSD82Arr9K4rc3TLSm8OQsfcNAT7ZGYRegc02BFANKf6rR1NUyoPOg/exec';
  const feedbackScreenshotUploadUrl = process.env.FEEDBACK_SCREENSHOT_UPLOAD_URL || defaultFeedbackScreenshotUploadUrl;
  const feedbackScreenshotToken = process.env.FEEDBACK_SCREENSHOT_TOKEN || 'skku-feedback-2026';

  return {
    entry: './src/main.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isDev ? 'bundle.js' : 'bundle.[contenthash:8].js',
      clean: true,
    },
    optimization: isDev ? undefined : {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: { drop_console: isProdBuild },
          },
        }),
      ],
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
      new webpack.DefinePlugin({
        // IS_PROD_BUILD is injected as a *boolean literal* (not a string)
        // so webpack's own optimizer constant-folds `if (!IS_PROD_BUILD)`
        // before chunk-graph generation. This is what makes the editor
        // chunk vanish entirely in `npm run build:prod` instead of just
        // becoming an unreferenced file in dist/.
        IS_PROD_BUILD: JSON.stringify(isProdBuild),
        'process.env.API_BASE_URL': JSON.stringify(apiBaseUrl),
        'process.env.VIDEO_BASE_URL': JSON.stringify(videoBaseUrl),
        __FEEDBACK_FORM_URL__: JSON.stringify(feedbackFormUrl),
        __FEEDBACK_ENTRY_TYPE__: JSON.stringify(feedbackEntryType),
        __FEEDBACK_ENTRY_TARGET__: JSON.stringify(feedbackEntryTarget),
        __FEEDBACK_ENTRY_DEBUG__: JSON.stringify(feedbackEntryDebug),
        __FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID__: JSON.stringify(feedbackEntryScreenshotReportId),
        __FEEDBACK_SCREENSHOT_UPLOAD_URL__: JSON.stringify(feedbackScreenshotUploadUrl),
        __FEEDBACK_SCREENSHOT_TOKEN__: JSON.stringify(feedbackScreenshotToken),
        'process.env.FEEDBACK_FORM_URL': JSON.stringify(feedbackFormUrl),
        'process.env.FEEDBACK_ENTRY_TYPE': JSON.stringify(feedbackEntryType),
        'process.env.FEEDBACK_ENTRY_TARGET': JSON.stringify(feedbackEntryTarget),
        'process.env.FEEDBACK_ENTRY_DEBUG': JSON.stringify(feedbackEntryDebug),
        'process.env.FEEDBACK_ENTRY_SCREENSHOT_REPORT_ID': JSON.stringify(feedbackEntryScreenshotReportId),
        'process.env.FEEDBACK_SCREENSHOT_UPLOAD_URL': JSON.stringify(feedbackScreenshotUploadUrl),
        'process.env.FEEDBACK_SCREENSHOT_TOKEN': JSON.stringify(feedbackScreenshotToken),
      }),
      new HtmlWebpackPlugin({
        template: './public/index.html',
      }),
      new MiniCssExtractPlugin({
        filename: 'style.[contenthash:8].css',
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: 'public/geojson',
            to: 'geojson',
            // Editor-only data must never ship to the public deploy:
            //   editor/save.json   — the editor's autosaved working state (~1.3 MiB)
            //   room_codes.json    — lookup table read only by src/editor/roomCodeLookup.ts (~580 KiB)
            // Both are dead weight (and internal data) once the editor chunk is
            // stripped, so the real-deploy build (build:prod) excludes them.
            // `npm run build` (internal test build, keeps the editor) still copies them.
            globOptions: isProdBuild
              ? { ignore: ['**/editor/**', '**/room_codes.json'] }
              : undefined,
          },
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

        // PUT /api/save-editor-state → write to public/geojson/editor/save.json
        // Editor's working file. Autosaved on every mutation. Distinct from
        // /api/save-graph (which is hit only at publish time and feeds the
        // runtime path-finding).
        devServer.app.put('/api/save-editor-state', jsonParser, (req, res) => {
          if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ error: 'body must be an object' });
          }
          const filePath = path.join(__dirname, 'public', 'geojson', 'editor', 'save.json');
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

        return middlewares;
      },
    },
    // Production builds (npm run build:prod) ship without sourcemaps so the
    // editor / debug TypeScript source isn't reachable from the deployed JS.
    devtool: isDev ? 'eval-source-map' : isProdBuild ? false : 'source-map',
  };
};
