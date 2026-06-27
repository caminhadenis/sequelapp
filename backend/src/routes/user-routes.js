import { authenticate, authorize } from '../middleware/auth.js';
import { Pelada } from '../models/Pelada.js';
import { User } from '../models/User.js';
import { recalculateAllUsersStats } from '../services/stats-service.js';
import {
  removeProfileImageByPublicPath,
  saveProfileImageFromDataUrl
} from '../utils/profile-image.js';
import { isWebPushConfigured, sendPushNotificationToUsers } from '../utils/push-notification.js';
import { trimExtremeRatings } from '../utils/rating-average.js';
import {
  canRequesterSeeRatings,
  sanitizeUserPayloadForRole
} from '../utils/user-visibility.js';

const VALID_POSITIONS = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];
const VALID_STAMINAS = ['BAIXA', 'MEDIA', 'ALTA'];

function normalizePositionInput(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeStaminaInput(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function totalGames(user) {
  return (
    Number(user?.totalWins || 0) +
    Number(user?.totalDraws || 0) +
    Number(user?.totalLosses || 0)
  );
}

function hasRachaHappened(dateValue, nowMs = Date.now()) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return date.getTime() <= nowMs;
}

function buildRachaParticipationSummary(peladas = []) {
  const participationsByUser = new Map();
  let totalHappenedRachas = 0;
  const nowMs = Date.now();

  for (const pelada of peladas || []) {
    if (!hasRachaHappened(pelada?.date, nowMs)) {
      continue;
    }

    totalHappenedRachas += 1;

    const participants = new Set();
    for (const team of pelada?.teams || []) {
      for (const playerId of team?.players || []) {
        participants.add(String(playerId));
      }
    }

    for (const playerId of participants) {
      participationsByUser.set(playerId, Number(participationsByUser.get(playerId) || 0) + 1);
    }
  }

  return {
    totalHappenedRachas,
    participationsByUser
  };
}

function minimumGamesForPositionRanking(totalHappenedRachas) {
  const total = Number(totalHappenedRachas || 0);
  if (total <= 0) {
    return 0;
  }

  return Math.ceil(total / 4);
}

function buildTopRankingByPosition(users = [], position, options = {}) {
  const minimumGames = Number(options?.minimumGames || 0);
  const gamesByUserId = options?.gamesByUserId instanceof Map ? options.gamesByUserId : null;

  const sorted = users
    .filter((user) => user.position === position)
    .map((user) => ({
      user,
      rating: Number(user.ratingAverage || 0),
      games: gamesByUserId ? Number(gamesByUserId.get(String(user._id)) || 0) : totalGames(user)
    }))
    .filter((item) => item.games >= minimumGames)
    .sort((a, b) => {
      const ratingDiff = b.rating - a.rating;
      if (ratingDiff !== 0) {
        return ratingDiff;
      }

      // Desempate para "melhor por posicao": mais jogos primeiro.
      const gamesDiff = b.games - a.games;
      if (gamesDiff !== 0) {
        return gamesDiff;
      }

      return String(a.user.name || '').localeCompare(String(b.user.name || ''), 'pt-BR');
    });

  const ranking = [];
  let previous = null;

  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    let rank = 1;

    if (previous) {
      const isTie = item.rating === previous.rating && item.games === previous.games;
      rank = isTie ? previous.rank : previous.rank + 1;
    }

    if (rank > 5) {
      break;
    }

    ranking.push({
      id: String(item.user._id),
      name: item.user.name,
      username: item.user.username,
      position: item.user.position,
      profileImageUrl: item.user.profileImageUrl || null,
      games: item.games,
      rank
    });

    previous = {
      rating: item.rating,
      games: item.games,
      rank
    };
  }

  return ranking;
}

function parsePushSubscription(input) {
  const subscription = input || {};
  const endpoint = String(subscription.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    expirationTime:
      typeof subscription.expirationTime === 'number' && Number.isFinite(subscription.expirationTime)
        ? subscription.expirationTime
        : null,
    keys: { p256dh, auth }
  };
}

function normalizeBroadcastMessage(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isTenthStepRating(value) {
  return Number.isFinite(value) && value >= 0.5 && value <= 5 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

export async function userRoutes(fastify) {
  fastify.get('/me', { preHandler: [authenticate] }, async (request) => {
    const user = await User.findById(request.user.id);
    if (!user) {
      return { message: 'Usuario nao encontrado.' };
    }

    return sanitizeUserPayloadForRole(user.toJSON(), request.user.role, {
      includeOwnRatings: true
    });
  });

  fastify.patch('/me/position', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem definir posicao.' });
    }

    const { position } = request.body || {};
    const normalizedPosition = normalizePositionInput(position);

    if (!VALID_POSITIONS.includes(normalizedPosition)) {
      return reply
        .code(400)
        .send({ message: 'Posicao invalida. Use ZAGUEIRO, MEIA ou ATACANTE.' });
    }

    const user = await User.findByIdAndUpdate(
      request.user.id,
      { $set: { position: normalizedPosition } },
      { new: true }
    );

    if (!user) {
      return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    }

    return {
      message: 'Posicao atualizada com sucesso.',
      user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role, {
        includeOwnRatings: true
      })
    };
  });

  fastify.patch('/me/field-profile', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem atualizar perfil em campo.' });
    }

    const { position, stamina } = request.body || {};
    const normalizedPosition = normalizePositionInput(position);

    const updates = {};
    if (position !== undefined) {
      if (!VALID_POSITIONS.includes(normalizedPosition)) {
        return reply
          .code(400)
          .send({ message: 'Posicao invalida. Use ZAGUEIRO, MEIA ou ATACANTE.' });
      }
      updates.position = normalizedPosition;
    }

    if (stamina !== undefined) {
      return reply.code(403).send({ message: 'Apenas ADM pode alterar stamina.' });
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ message: 'Informe a posicao para atualizar.' });
    }

    const user = await User.findByIdAndUpdate(
      request.user.id,
      { $set: updates },
      { new: true }
    );

    if (!user) {
      return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    }

    return {
      message: 'Perfil em campo atualizado com sucesso.',
      user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role, {
        includeOwnRatings: true
      })
    };
  });

  fastify.patch('/me/profile', { preHandler: [authenticate] }, async (request, reply) => {
    const { name, lastName, profileImageDataUrl } = request.body || {};

    const normalizedName = String(name || '')
      .trim()
      .replace(/\s+/g, ' ');
    const normalizedLastName = String(lastName || '')
      .trim()
      .replace(/\s+/g, ' ');

    if (!normalizedName || !normalizedLastName) {
      return reply.code(400).send({ message: 'Informe nome e sobrenome.' });
    }

    const user = await User.findById(request.user.id);
    if (!user) {
      return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    }

    let nextProfileImageUrl = user.profileImageUrl || null;
    const currentProfileImageUrl = user.profileImageUrl || null;

    try {
      if (profileImageDataUrl !== undefined) {
        if (profileImageDataUrl === null || String(profileImageDataUrl).trim() === '') {
          await removeProfileImageByPublicPath(currentProfileImageUrl);
          nextProfileImageUrl = null;
        } else if (typeof profileImageDataUrl === 'string') {
          const uploadedImageUrl = await saveProfileImageFromDataUrl(user._id, profileImageDataUrl);
          await removeProfileImageByPublicPath(currentProfileImageUrl);
          nextProfileImageUrl = uploadedImageUrl;
        } else {
          return reply.code(400).send({ message: 'Formato de imagem de perfil invalido.' });
        }
      }
    } catch (error) {
      return reply.code(400).send({ message: error.message || 'Falha ao processar imagem de perfil.' });
    }

    user.name = `${normalizedName} ${normalizedLastName}`.trim();
    user.profileImageUrl = nextProfileImageUrl || undefined;
    await user.save();

    return {
      message: 'Perfil atualizado com sucesso.',
      user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role, {
        includeOwnRatings: true
      })
    };
  });

  fastify.post('/me/push-subscriptions', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem registrar notificações push.' });
    }

    if (!isWebPushConfigured()) {
      return reply.code(503).send({
        message:
          'Notificações push não configuradas no servidor. Defina WEB_PUSH_PUBLIC_KEY e WEB_PUSH_PRIVATE_KEY.'
      });
    }

    const parsedSubscription = parsePushSubscription(request.body?.subscription);
    if (!parsedSubscription) {
      return reply.code(400).send({
        message: 'Subscription inválida. Informe endpoint e keys (p256dh/auth).'
      });
    }

    const user = await User.findById(request.user.id);
    if (!user) {
      return reply.code(404).send({ message: 'Usuario nao encontrado.' });
    }

    const now = new Date();
    const userAgent = String(request.headers['user-agent'] || '').trim();
    const existing = (user.pushSubscriptions || []).find(
      (subscription) => String(subscription.endpoint) === parsedSubscription.endpoint
    );

    if (existing) {
      existing.expirationTime = parsedSubscription.expirationTime;
      existing.keys = parsedSubscription.keys;
      existing.userAgent = userAgent;
      existing.updatedAt = now;
    } else {
      user.pushSubscriptions.push({
        ...parsedSubscription,
        userAgent,
        createdAt: now,
        updatedAt: now
      });
    }

    await user.save();

    return {
      message: 'Subscription push registrada com sucesso.'
    };
  });

  fastify.post('/me/push-subscriptions/remove', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem remover notificações push.' });
    }

    const endpoint = String(request.body?.endpoint || '').trim();
    if (!endpoint) {
      return reply.code(400).send({ message: 'Informe o endpoint da subscription para remoção.' });
    }

    await User.updateOne(
      { _id: request.user.id },
      {
        $pull: {
          pushSubscriptions: {
            endpoint
          }
        }
      }
    );

    return { message: 'Subscription push removida com sucesso.' };
  });

  fastify.get(
    '/pending',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async () => {
      const pendingUsers = await User.find(
        {
          role: 'JOGADOR',
          approvalStatus: 'PENDING'
        },
        'name username role approvalStatus createdAt'
      )
        .sort({ createdAt: 1, name: 1 })
        .lean();

      return pendingUsers.map((user) => ({
        id: String(user._id),
        name: user.name,
        username: user.username,
        role: user.role,
        approvalStatus: user.approvalStatus,
        createdAt: user.createdAt
      }));
    }
  );

  fastify.post(
    '/notifications/broadcast',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      if (!isWebPushConfigured()) {
        return reply.code(503).send({
          message:
            'Notificações push não configuradas no servidor. Defina WEB_PUSH_PUBLIC_KEY e WEB_PUSH_PRIVATE_KEY.'
        });
      }

      const text = normalizeBroadcastMessage(request.body?.message);
      if (!text) {
        return reply.code(400).send({ message: 'Informe uma mensagem para enviar aos jogadores.' });
      }

      if (text.length > 180) {
        return reply.code(400).send({ message: 'A mensagem deve ter no máximo 180 caracteres.' });
      }

      const players = await User.find(
        {
          role: 'JOGADOR',
          $or: [{ approvalStatus: 'APPROVED' }, { approvalStatus: { $exists: false } }]
        },
        '_id'
      ).lean();

      if (players.length === 0) {
        return reply.code(404).send({ message: 'Não há jogadores aprovados para receber notificações.' });
      }

      const result = await sendPushNotificationToUsers(
        players.map((player) => String(player._id)),
        {
          title: 'Recado do ADM',
          body: text,
          url: '/peladas'
        }
      );

      return {
        message: 'Notificação enviada para os jogadores.',
        playersCount: players.length,
        sent: result.sent,
        failed: result.failed
      };
    }
  );

  fastify.get('/', { preHandler: [authenticate] }, async (request) => {
    const canSeeRatings = canRequesterSeeRatings(request.user);
    const sort = canSeeRatings
      ? { totalGoals: -1, totalAssists: -1, ratingAverage: -1, name: 1 }
      : { totalGoals: -1, totalAssists: -1, name: 1 };

    const users = await User.find({
      role: 'JOGADOR',
      $or: [{ approvalStatus: 'APPROVED' }, { approvalStatus: { $exists: false } }]
    })
      .sort(sort)
      .lean();

    return users.map((user) => ({
      id: String(user._id),
      name: user.name,
      username: user.username,
      role: user.role,
      profileImageUrl: user.profileImageUrl,
      position: user.position,
      ...(canSeeRatings ? { stamina: user.stamina || 'MEDIA' } : {}),
      approvalStatus: user.approvalStatus || 'APPROVED',
      ...(canSeeRatings ? { ratingAverage: user.ratingAverage } : {}),
      totalGoals: user.totalGoals,
      totalAssists: user.totalAssists,
      totalWins: user.totalWins,
      totalDraws: user.totalDraws,
      totalLosses: user.totalLosses,
      totalCraquePoints: user.totalCraquePoints || 0,
      totalCraqueFirstPlaces: user.totalCraqueFirstPlaces || 0,
      totalCraqueSecondPlaces: user.totalCraqueSecondPlaces || 0,
      totalCraqueThirdPlaces: user.totalCraqueThirdPlaces || 0,
      totalTournamentTitles: user.totalTournamentTitles || 0
    }));
  });

  fastify.get(
    '/ranking/by-position',
    {
      preHandler: [authenticate]
    },
    async () => {
      const users = await User.find(
        {
          role: 'JOGADOR',
          $or: [{ approvalStatus: 'APPROVED' }, { approvalStatus: { $exists: false } }]
        },
        'name username position profileImageUrl ratingAverage totalWins totalDraws totalLosses'
      ).lean();

      const peladas = await Pelada.find({}, 'date teams.players').lean();
      const participationSummary = buildRachaParticipationSummary(peladas);
      const minimumGames = minimumGamesForPositionRanking(participationSummary.totalHappenedRachas);

      return {
        totalHappenedRachas: participationSummary.totalHappenedRachas,
        minimumGames,
        zagueiro: buildTopRankingByPosition(users, 'ZAGUEIRO', {
          minimumGames,
          gamesByUserId: participationSummary.participationsByUser
        }),
        meia: buildTopRankingByPosition(users, 'MEIA', {
          minimumGames,
          gamesByUserId: participationSummary.participationsByUser
        }),
        atacante: buildTopRankingByPosition(users, 'ATACANTE', {
          minimumGames,
          gamesByUserId: participationSummary.participationsByUser
        })
      };
    }
  );

  fastify.get(
    '/:id',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const user = await User.findOne(
        {
          _id: request.params.id,
          role: 'JOGADOR'
        }
      );

      if (!user) {
        return reply.code(404).send({ message: 'Jogador nao encontrado.' });
      }

      const totalRachas = await Pelada.countDocuments({
        date: { $lte: new Date() },
        'teams.players': user._id
      });

      return {
        ...sanitizeUserPayloadForRole(user.toJSON(), request.user.role),
        totalRachas: Number(totalRachas || 0)
      };
    }
  );

  fastify.patch(
    '/:id/field-profile',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { position, stamina } = request.body || {};
      const normalizedPosition = normalizePositionInput(position);
      const normalizedStamina = normalizeStaminaInput(stamina);

      const updates = {};

      if (position !== undefined) {
        if (!VALID_POSITIONS.includes(normalizedPosition)) {
          return reply
            .code(400)
            .send({ message: 'Posicao invalida. Use ZAGUEIRO, MEIA ou ATACANTE.' });
        }
        updates.position = normalizedPosition;
      }

      if (stamina !== undefined) {
        if (!VALID_STAMINAS.includes(normalizedStamina)) {
          return reply
            .code(400)
            .send({ message: 'Stamina invalida. Use BAIXA, MEDIA ou ALTA.' });
        }
        updates.stamina = normalizedStamina;
      }

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ message: 'Informe ao menos posicao ou stamina para atualizar.' });
      }

      const user = await User.findOneAndUpdate(
        {
          _id: request.params.id,
          role: 'JOGADOR'
        },
        { $set: updates },
        { new: true }
      );

      if (!user) {
        return reply.code(404).send({ message: 'Jogador nao encontrado.' });
      }

      return {
        message: 'Perfil em campo do jogador atualizado.',
        user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role)
      };
    }
  );

  fastify.patch(
    '/:id/global-rating',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { id } = request.params;
      const ratingAverage = Number(request.body?.ratingAverage);

      if (!isTenthStepRating(ratingAverage)) {
        return reply
          .code(400)
          .send({ message: 'A nota global deve ser um numero entre 0.5 e 5.0, em intervalos de 0.1.' });
      }

      const normalizedRating = Number(ratingAverage.toFixed(1));
      const user = await User.findOne({
        _id: id,
        role: 'JOGADOR'
      });

      if (!user) {
        return reply.code(404).send({ message: 'Jogador nao encontrado.' });
      }

      const peladasWithVotes = await Pelada.find(
        {
          votingStatus: 'FINISHED',
          'votes.toUser': user._id
        },
        'votes.toUser votes.score'
      ).lean();
      const existingVoteCount = peladasWithVotes.reduce(
        (total, pelada) =>
          total +
          trimExtremeRatings(
            (pelada.votes || []).filter(
              (vote) => String(vote.toUser) === String(user._id)
            )
          ).length,
        0
      );

      user.ratingAverage = normalizedRating;
      user.manualRatingAverage = normalizedRating;
      user.manualRatingBaseCount = Math.max(existingVoteCount, 1);
      user.manualRatingSetAt = new Date();
      await user.save();

      return {
        message: 'Nota global atualizada. Novas avaliações serão incorporadas a esta média.',
        user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role)
      };
    }
  );

  fastify.patch(
    '/:id/approve',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { id } = request.params;

      const user = await User.findOneAndUpdate(
        {
          _id: id,
          role: 'JOGADOR'
        },
        { $set: { approvalStatus: 'APPROVED' } },
        { new: true }
      );

      if (!user) {
        return reply.code(404).send({ message: 'Jogador nao encontrado.' });
      }

      return {
        message: 'Jogador aprovado com sucesso.',
        user: sanitizeUserPayloadForRole(user.toJSON(), request.user.role)
      };
    }
  );

  fastify.patch(
    '/:id/initial-rating',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { id } = request.params;
      const { initialRating } = request.body || {};

      if (typeof initialRating !== 'number' || initialRating < 1 || initialRating > 5) {
        return reply
          .code(400)
          .send({ message: 'A nota inicial deve ser um numero entre 1 e 5.' });
      }

      const user = await User.findByIdAndUpdate(
        id,
        {
          $set: { initialRating, ratingAverage: initialRating },
          $unset: {
            manualRatingAverage: '',
            manualRatingBaseCount: '',
            manualRatingSetAt: ''
          }
        },
        { new: true }
      );

      if (!user) {
        return reply.code(404).send({ message: 'Usuario nao encontrado.' });
      }

      await recalculateAllUsersStats();

      return sanitizeUserPayloadForRole(user.toJSON(), request.user.role);
    }
  );
}
