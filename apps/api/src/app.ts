import cors from 'cors';
import express from 'express';

import type { HealthResponse } from '@kagaz/shared-types';
import type { ErrorRequestHandler, Express } from 'express';

export function createApp(allowedOrigins: string[]): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin is not allowed by CORS policy.'));
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_request, response) => {
    const payload = {
      status: 'ok',
      service: 'kagaz-api',
      timestamp: new Date().toISOString(),
    } satisfies HealthResponse;

    response.status(200).json(payload);
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    console.error(error);
    response.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);
  return app;
}
