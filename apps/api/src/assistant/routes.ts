import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import type { AssistantErrorResponse } from '@kagaz/shared-types';
import { AssistantError } from './errors.js';
import type { AssistantService } from './service.js';

function failure(response: Response, error: unknown) {
  const sanitized =
    error instanceof AssistantError
      ? error
      : new AssistantError(
          'quota-unavailable',
          503,
          'AI usage could not be verified. No new generation was started.',
        );
  if (!response.headersSent && !response.destroyed)
    response.status(sanitized.status).json({
      error: { code: sanitized.code, message: sanitized.message },
    } satisfies AssistantErrorResponse);
}

export function registerAssistantRoutes(
  app: Express,
  assistant: AssistantService,
) {
  app.use('/assistant', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    next();
  });
  app.get('/assistant/usage', async (request, response) => {
    try {
      const identity = await assistant.authorize(request);
      response.json(await assistant.usage(identity.uid));
    } catch (error) {
      failure(response, error);
    }
  });
  // Authentication runs before consuming JSON. This endpoint never accepts files.
  app.post(
    '/assistant/answer',
    async (request, response, next) => {
      try {
        const identity = await assistant.authorize(request);
        response.locals.assistantUid = identity.uid;
        next();
      } catch (error) {
        failure(response, error);
      }
    },
    (request, response, next) => {
      if (
        !request.is('application/json') ||
        request.headers['content-encoding']
      ) {
        failure(
          response,
          new AssistantError(
            'invalid-request',
            400,
            'AI Chat accepts an uncompressed JSON context request only.',
          ),
        );
        return;
      }
      express.json({ limit: '64kb', strict: true })(
        request,
        response,
        (error: unknown) => {
          if (error)
            failure(
              response,
              new AssistantError(
                'invalid-request',
                400,
                'The AI request is invalid or exceeds the context limit.',
              ),
            );
          else next();
        },
      );
    },
    async (request: Request, response: Response, _next: NextFunction) => {
      const controller = new AbortController();
      const abort = () => {
        if (!response.writableEnded) controller.abort();
      };
      request.once('aborted', abort);
      response.once('close', abort);
      try {
        const uid: unknown = response.locals.assistantUid;
        if (typeof uid !== 'string')
          throw new AssistantError(
            'invalid-authentication',
            401,
            'Sign in again.',
          );
        const body: unknown = request.body;
        const result = await assistant.answer(uid, body, controller.signal);
        if (!response.destroyed) response.json(result);
      } catch (error) {
        failure(response, error);
      } finally {
        request.off('aborted', abort);
        response.off('close', abort);
      }
    },
  );
}
