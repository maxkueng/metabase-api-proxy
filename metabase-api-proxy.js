#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { asyncMiddleware } = require('middleware-async')
const httpProxy = require('http-proxy');
const yargs = require('yargs');
const yaml = require('yaml');
const axios = require('axios');

const argv = yargs
  .option('config', {
    alias: 'c',
    describe: 'Path to config file in YAML or JSON',
    type: 'string',
    default: '.metabase-api-proxy.conf',
  })
  .argv;

const defaultConfig = {
  proxy: {
    hostname: 'localhost',
    address: '0.0.0.0',
    port: null,
    ssl: false,
    keyfile: 'privkey.pem',
    certfile: 'fullchain.pem',
    target: null,
  },
  metabase: {
    apiPath: '/api',
    email: null,
    password: null,
  },
};

async function checkSessionID(host, sessionID) {
  try {
    const res = await axios.request({
      method: 'GET',
      url: `${host}/api/user/current`,
      headers: {
        'X-Metabase-Session': sessionID,
      },
    });
    return true;
  } catch (err) {
    if (err.response.status === 401) {
      return false;
    }
    throw err;
  }
}

async function getSessionID(host, credentials) {
  const {
    email: username,
    password,
  } = credentials;

  const res = await axios.request({
    method: 'POST',
    url: `${host}/api/session`,
    data: {
      username,
      password,
    },
  });

  return res.data.id;
}

function isFile(filePath) {
  try {
    const stat = fs.statSync(path.resolve(filePath));
    return stat.isFile();
  } catch (err) {
    return false;
  }
}

function checkConfig({ proxy, metabase }) {
  if (!proxy) throw new Error('Missing proxy configuration');
  if (!proxy.target) throw new Error('Missing proxy.target configuration');

  if (proxy.ssl) {
    if (!isFile(proxy.keyfile)) throw new Error(`proxy.keyfile not found at '${proxy.keyfile}'`);
    if (!isFile(proxy.certfile)) throw new Error(`proxy.certfile not found at '${proxy.certfile}'`);
  }

  if (!metabase) throw new Error('Missing metabase configuration');
  if (!metabase.email) throw new Error('Missing metabase.email configuration');
  if (!metabase.password) throw new Error('Missing metabase.password configuration');
}

function getConfig() {
  const configPath = path.resolve(argv.config);
  try {
    const stat = fs.statSync(configPath);
    if (!stat.isFile()) {
      throw new Error(`Config path is not a file`);
    }
  } catch (err) {
    console.error(`Config file does not exist at '${configPath}'`);
    process.exit(1);
  }

  const contents = fs.readFileSync(configPath, 'utf-8');
  console.log(contents);

  let values;
  try {
    values = yaml.parse(contents);
  } catch (err) {
    console.log(err);
    try {
      values = JSON.parse(contents);
    } catch (err) {
      console.error('Config file must be in YAML or JSON format');
      process.exit(1);
    }
  }

  const config = {
    proxy: {
      ...defaultConfig.proxy,
      ...(values.proxy || {}),
    },
    metabase: {
      ...defaultConfig.metabase,
      ...(values.metabase || {}),
    },
  };

  try {
    checkConfig(config);
  } catch (err) {
    console.error(`Config error: ${err.message}`)
    process.exit(1);
  }

  return config;
}

function getPort(config) {
  if (config.proxy.port) {
    return config.proxy.port;
  }
  if (config.proxy.ssl) {
    return 443;
  }
  return 80;
}

function createServer(config, requestListener) {
  if (config.proxy.ssl) {
    const keyfilePath = path.resolve(config.proxy.keyfile);
    const certfilePath = path.resolve(config.proxy.certfile);

    return https.createServer({
      key: fs.readFileSync(keyfilePath, 'utf-8'),
      cert: fs.readFileSync(certfilePath, 'utf-8'),
    }, requestListener);
  }

  return http.createServer(requestListener);
}

function start() {
  const config = getConfig();
  const app = express();
  let sessionID = null;

  const proxy = httpProxy.createProxyServer({
    target: config.proxy.target,
  });

  proxy.on('proxyReq', function(proxyReq, req, res, options) {
    proxyReq.setHeader('X-Metabase-Session', sessionID);
  });

  proxy.on('error', (err, req, res) => {
    console.error(err);
    res.writeHead(500, {
      'Content-Type': 'text/plain',
    });
    res.end('Something went wrong.');
  });

  app.use(asyncMiddleware(async (req, res, next) => {
    const isSessionValid = await checkSessionID(config.proxy.target, sessionID);
    if (!isSessionValid) {
      const id = await getSessionID(config.proxy.target, {
        email: config.metabase.email,
        password: config.metabase.password,
      });
      sessionID = id;
    }
    next();
  }));

  app.use((req, res) => {
    proxy.web(req, res);
  });

  const server = createServer(config, app);
  const port = getPort(config);

  server.listen(port, config.proxy.address, () => {
    console.info(`Listening at ${config.proxy.ssl ? 'https:' : 'http:'}//${config.proxy.address}:${port}`);
    const publicURL = [
      config.proxy.ssl ? 'https://' : 'http://',
      config.proxy.hostname,
      config.proxy.ssl && port !== 443 ? `:${port}` : '',
      !config.proxy.ssl && port !== 80 ? `:${port}` : '',
      '/',
    ].join('');
    console.info(`Open ${publicURL}`);
  });

  const shutdown = (signal, value) => {
    server.close(() => {
      proxy.close(() => {
        console.log(`Server stopped by ${signal} with value ${value}`);
        process.exit(128 + value);
      });
    });
  };

  const signals = {
    'SIGHUP': 1,
    'SIGINT': 2,
    'SIGTERM': 15,
  };

  Object.entries(signals).forEach(([signal, value]) => {
    process.on(signal, () => {
      console.log(`process received a ${signal} signal`);
      shutdown(signal, value);
    });
  });
}

start();
