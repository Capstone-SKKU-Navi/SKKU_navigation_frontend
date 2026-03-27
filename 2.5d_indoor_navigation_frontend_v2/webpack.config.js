const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

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
      static: { directory: path.join(__dirname, 'public'), watch: false },
      port: 8082,
      hot: true,
      liveReload: true,
      open: true,
      watchFiles: ['src/**/*', 'scss/**/*', 'public/index.html'],
      client: { overlay: false }, // disable error overlay blocking clicks
      setupMiddlewares(middlewares, devServer) {
        const jsonParser = require('express').json({ limit: '10mb' });

        // PUT /api/save-graph → write to public/geojson/graph.json
        devServer.app.put('/api/save-graph', jsonParser, (req, res) => {
          const filePath = path.join(__dirname, 'public', 'geojson', 'graph.json');
          fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
          res.json({ ok: true });
        });

        // PUT /api/save-rooms/:level → write to public/geojson/eng1/eng1_room_L{level}.geojson
        devServer.app.put('/api/save-rooms/:level', jsonParser, (req, res) => {
          const level = req.params.level;
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
