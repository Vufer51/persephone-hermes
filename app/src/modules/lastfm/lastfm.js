import { createLastFmService } from './lastfm-service.js';

/**
 * Регистрирует маршруты Last.fm интеграции.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { config } = app;
  const lastfmService = createLastFmService({ pool: database.pool, config });

  // GET /api/v1/integrations/lastfm/auth-url — URL для авторизации
  app.get('/api/v1/integrations/lastfm/auth-url', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          callbackUrl: { type: 'string', format: 'uri' },
        },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const callbackUrl = request.query.callbackUrl ?? config.webOrigin ?? 'http://localhost:5173/callback';
      const authUrl = lastfmService.getAuthUrl(callbackUrl);
      return { authUrl };
    },
  });

  // POST /api/v1/integrations/lastfm/callback — обмен токена на session_key
  app.post('/api/v1/integrations/lastfm/callback', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1 } },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      const { token } = request.body;

      const result = await lastfmService.handleCallback(token, userId);
      return result;
    },
  });

  // GET /api/v1/integrations/lastfm/status — статус подключения
  app.get('/api/v1/integrations/lastfm/status', {
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      const status = await lastfmService.getStatus(userId);

      if (!status) {
        return { connected: false, lastfm_username: null, status: 'disconnected' };
      }

      return {
        connected: status.status === 'connected',
        lastfm_username: status.lastfm_username,
        status: status.status,
        last_synced_at: status.last_synced_at,
      };
    },
  });

  // DELETE /api/v1/integrations/lastfm — отключение
  app.delete('/api/v1/integrations/lastfm', {
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      await lastfmService.disconnect(userId);
      return { disconnected: true };
    },
  });

  // POST /api/v1/integrations/lastfm/now-playing — обновление Now Playing
  app.post('/api/v1/integrations/lastfm/now-playing', {
    schema: {
      body: {
        type: 'object',
        required: ['artist', 'track'],
        properties: {
          artist: { type: 'string', minLength: 1, maxLength: 256 },
          track: { type: 'string', minLength: 1, maxLength: 256 },
          album: { type: 'string', maxLength: 256 },
          duration: { type: 'integer', minimum: 1 },
        },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      const { artist, track, album, duration } = request.body;

      await lastfmService.updateNowPlaying(userId, { artist, track, album, duration });
      return { success: true };
    },
  });

  // POST /api/v1/integrations/lastfm/sync — полная синхронизация данных
  app.post('/api/v1/integrations/lastfm/sync', {
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;

      const results = await lastfmService.syncUserData(userId);
      return { success: true, results };
    },
  });
}