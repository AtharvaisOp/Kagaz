import cors from 'cors';
import express from 'express';

import type { HealthResponse } from '@kagaz/shared-types';
import type { ErrorRequestHandler, Express } from 'express';
import { COMPRESSION_HEADERS, ToolService } from './tools/service.js';

export function createApp(
  allowedOrigins: string[],
  tools = new ToolService(),
): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      exposedHeaders: COMPRESSION_HEADERS,
      methods: ['GET', 'POST', 'OPTIONS'],
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      },
    }),
  );
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      response.status(403).json({
        error: {
          code: 'invalid-request',
          message: 'This origin is not allowed.',
        },
      });
      return;
    }
    next();
  });

  app.get('/health', (_request, response) => {
    const payload = {
      status: 'ok',
      service: 'kagaz-api',
      timestamp: new Date().toISOString(),
    } satisfies HealthResponse;

    response.status(200).json(payload);
  });

  app.post('/tools/compress', (request, response) =>
    tools.handle(request, response),
  );

  // Multipart tools own their parser and limits. Future JSON routes use this one.
  app.use(express.json({ limit: '100kb' }));

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    console.error('API request failed.', {
      name: error instanceof Error ? error.name : 'unknown',
    });
    response.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);
  return app;
}
