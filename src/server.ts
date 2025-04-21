import path from 'path';
import fs from 'fs';
import type { Socket } from 'net';
import http, { ServerResponse } from 'http';
import type {
  IncomingMessage,
  RequestListener,
} from 'http';
import https from 'https';
import express from 'express';
import cors from 'cors';
import { asyncMiddleware } from 'middleware-async';
import httpProxy from 'http-proxy';
import type { Logger } from 'pino';

import type { Config } from "./config";
import * as metabase from './metabase';

function getPort(config: Config) {
  if (config.proxy.port) {
    return config.proxy.port;
  }
  if (config.proxy.ssl) {
    return 443;
  }
  return 80;
}

function createServer(config: Config, requestListener: RequestListener) {
  if (config.proxy.ssl) {
    const keyfilePath = path.resolve(config.proxy.keyFile);
    const certfilePath = path.resolve(config.proxy.certFile);

    return https.createServer({
      key: fs.readFileSync(keyfilePath, 'utf-8'),
      cert: fs.readFileSync(certfilePath, 'utf-8'),
    }, requestListener);
  }

  return http.createServer(requestListener);
}

const enableCors = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
  res.setHeader('access-control-allow-methods', '*');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-credentials', 'true');
};

export function startServer(config: Config, logger: Logger) {
  const app = express();
  let sessionId: string | null = null;

  const proxy = httpProxy.createProxyServer({
    target: config.proxy.target,
    secure: false,
  });

  proxy.on('proxyReq', (proxyReq, req, res, options) => {
    if (sessionId) {
      proxyReq.setHeader('X-Metabase-Session', sessionId);
    }
  });

  proxy.on('proxyRes', (proxyRes, req, res) => {
    enableCors(req, res);
  });

  proxy.on('error', (err, _req, res) => {
    logger.error('Proxy error:', err);
  
    if (res instanceof ServerResponse) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Something went wrong.');
    } else {
      logger.error('Response is not a ServerResponse, skipping writeHead');
    }
  });

  app.use(asyncMiddleware(async (req, res, next) => {
    const isSessionValid = await metabase.checkSessionId(config.proxy.target, sessionId);
    if (!isSessionValid) {
      const id = await metabase.getSessionId(config.proxy.target, {
        email: config.metabase.email,
        password: config.metabase.password,
      });
      sessionId = id;
    }
    next();
  }));

  app.use((req, res) => {
    proxy.web(req, res);
  });

  app.use(cors({
    origin: '*',
  }));

  const server = createServer(config, app);
  const port = getPort(config);

  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.listen(port, config.proxy.address, () => {
    logger.info(`Listening at ${config.proxy.ssl ? 'https:' : 'http:'}//${config.proxy.address}:${port}`);
    const publicURL = [
      config.proxy.ssl ? 'https://' : 'http://',
      config.proxy.hostname,
      config.proxy.ssl && port !== 443 ? `:${port}` : '',
      !config.proxy.ssl && port !== 80 ? `:${port}` : '',
      '/',
    ].join('');
    logger.info(`Open ${publicURL}`);
  });
  
  return (callback: () => void) => {
    logger.info('Closing server');
    server.close(() => {
      logger.info('Destroying sockets');
      for (const socket of sockets) {
        socket.destroy();
      }
      logger.info('Closing proxy');
      proxy.close(callback);
    });
  };
}
