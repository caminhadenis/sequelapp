import { authenticate, authorize } from '../middleware/auth.js';
import { Pelada } from '../models/Pelada.js';
import { User } from '../models/User.js';
import { recalculateAllUsersStats } from '../services/stats-service.js';
import { getParticipantIdSet, validateTeamsShape } from '../utils/pelada.js';
import {
  buildTournamentInfo,
  generateDoubleRoundRobinMatches,
  syncTeamResultsFromMatches
} from '../utils/tournament.js';
import { drawBalancedTeams } from '../utils/team-draw.js';
import { sendPushNotificationToUsers } from '../utils/push-notification.js';
import { summarizeRachaRatings } from '../utils/rating-average.js';
import { canRequesterSeeRatings } from '../utils/user-visibility.js';
import { buildSelectionOfRound } from '../utils/selection-of-round.js';

const CRAQUE_WEIGHTS = {
  firstUser: 5,
  secondUser: 3,
  thirdUser: 1
};
const PRESENCE_LIMIT = 20;

function isHalfStepScore(value) {
  if (!Number.isFinite(value) || value < 0.5 || value > 5) {
    return false;
  }

  return Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

function formatPeladaSummary(pelada) {
  const date = new Date(pelada.date);
  return {
    id: String(pelada._id),
    date,
    type: pelada.type || 'NORMAL',
    happened: date.getTime() <= Date.now(),
    status: pelada.status || 'OPEN',
    votingStatus: pelada.votingStatus,
    teamsCount: (pelada.teams || []).length
  };
}

function buildPlayerStatsMap(playerStats = []) {
  const map = new Map();
  for (const stat of playerStats) {
    map.set(String(stat.player), {
      goals: Number(stat.goals || 0),
      assists: Number(stat.assists || 0)
    });
  }
  return map;
}

function buildTeamResultByPlayer(teams = []) {
  const map = new Map();
  for (const team of teams) {
    for (const playerId of team.players || []) {
      map.set(String(playerId), {
        wins: Number(team.wins || 0),
        draws: Number(team.draws || 0),
        losses: Number(team.losses || 0)
      });
    }
  }
  return map;
}

function isConcluded(pelada) {
  return (pelada?.status || 'OPEN') === 'CONCLUDED';
}

function hasRachaHappened(pelada) {
  return new Date(pelada?.date).getTime() <= Date.now();
}

function isPresenceEligibleRacha(pelada) {
  return !isConcluded(pelada) && !hasRachaHappened(pelada);
}

function isPresenceWindowOpen(pelada, now = new Date()) {
  const presenceOpenAt = pelada?.presenceOpenAt ? new Date(pelada.presenceOpenAt) : null;
  if (!presenceOpenAt || Number.isNaN(presenceOpenAt.getTime())) {
    return false;
  }

  return presenceOpenAt.getTime() <= now.getTime();
}

function sortPresenceEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const aTime = new Date(a?.markedAt || 0).getTime();
    const bTime = new Date(b?.markedAt || 0).getTime();
    if (aTime !== bTime) {
      return aTime - bTime;
    }

    return String(a?._id || '').localeCompare(String(b?._id || ''));
  });
}

function buildPresenceInfoForResponse(pelada, currentUserId) {
  const sortedEntries = sortPresenceEntries(pelada?.presenceEntries || []);
  const entries = sortedEntries.map((entry, index) => {
    const user = entry?.user && typeof entry.user === 'object' ? entry.user : null;
    const userId = String(user?._id || entry?.user || '');
    return {
      order: index + 1,
      userId,
      userName: user?.name || 'Jogador removido',
      username: user?.username || '',
      profileImageUrl: user?.profileImageUrl || null,
      markedAt: entry?.markedAt || null,
      isWaitingList: index >= PRESENCE_LIMIT
    };
  });

  const normalizedCurrentUserId = String(currentUserId || '');
  const myEntry = entries.find((entry) => entry.userId === normalizedCurrentUserId) || null;
  const canMarkNow = isPresenceEligibleRacha(pelada) && isPresenceWindowOpen(pelada);

  return {
    limit: PRESENCE_LIMIT,
    openAt: pelada?.presenceOpenAt || null,
    isEligibleRacha: isPresenceEligibleRacha(pelada),
    canMarkNow,
    totalMarked: entries.length,
    confirmedCount: Math.min(PRESENCE_LIMIT, entries.length),
    waitingCount: Math.max(entries.length - PRESENCE_LIMIT, 0),
    myEntry,
    entries
  };
}

function ensureEditableRacha(pelada, reply) {
  if (!isConcluded(pelada)) {
    return true;
  }

  reply.code(409).send({
    message: 'Este racha ja foi concluido e nao permite mais ajustes.'
  });
  return false;
}

function computeCraqueRanking(craqueVotes = []) {
  const ranking = new Map();

  function ensurePlayerEntry(playerId) {
    if (!ranking.has(playerId)) {
      ranking.set(playerId, {
        playerId,
        points: 0,
        firstPlaces: 0,
        secondPlaces: 0,
        thirdPlaces: 0
      });
    }

    return ranking.get(playerId);
  }

  for (const vote of craqueVotes) {
    const firstId = String(vote.firstUser);
    const secondId = String(vote.secondUser);
    const thirdId = String(vote.thirdUser);

    const first = ensurePlayerEntry(firstId);
    const second = ensurePlayerEntry(secondId);
    const third = ensurePlayerEntry(thirdId);

    first.points += CRAQUE_WEIGHTS.firstUser;
    first.firstPlaces += 1;

    second.points += CRAQUE_WEIGHTS.secondUser;
    second.secondPlaces += 1;

    third.points += CRAQUE_WEIGHTS.thirdUser;
    third.thirdPlaces += 1;
  }

  return Array.from(ranking.values())
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.firstPlaces !== a.firstPlaces) return b.firstPlaces - a.firstPlaces;
      if (b.secondPlaces !== a.secondPlaces) return b.secondPlaces - a.secondPlaces;
      if (b.thirdPlaces !== a.thirdPlaces) return b.thirdPlaces - a.thirdPlaces;
      return a.playerId.localeCompare(b.playerId);
    })
    .slice(0, 3);
}

function buildCraquePodiumFromRanking(ranking = [], usersById = new Map(), totalBallots = 0) {
  const top3 = ranking
    .map((item, index) => ({
      position: index + 1,
      ...item,
      playerName: usersById.get(item.playerId)?.name || 'Jogador removido'
    }))
    .sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.playerName.localeCompare(b.playerName);
    });

  return {
    totalBallots,
    top3
  };
}

function buildCraqueResultSnapshot(craqueVotes = []) {
  const ranking = computeCraqueRanking(craqueVotes);
  return {
    totalBallots: craqueVotes.length,
    top3: ranking.map((item, index) => ({
      position: index + 1,
      player: item.playerId,
      points: item.points,
      firstPlaces: item.firstPlaces,
      secondPlaces: item.secondPlaces,
      thirdPlaces: item.thirdPlaces
    }))
  };
}

function buildCraquePodiumFromSavedResult(craqueResult = null, usersById = new Map()) {
  if (!craqueResult || !Array.isArray(craqueResult.top3) || craqueResult.top3.length === 0) {
    return {
      totalBallots: 0,
      top3: []
    };
  }

  const ranking = craqueResult.top3.map((item) => ({
    playerId: String(item.player),
    points: Number(item.points || 0),
    firstPlaces: Number(item.firstPlaces || 0),
    secondPlaces: Number(item.secondPlaces || 0),
    thirdPlaces: Number(item.thirdPlaces || 0)
  }));

  return buildCraquePodiumFromRanking(ranking, usersById, Number(craqueResult.totalBallots || 0));
}

function buildCraquePodiumForResponse(pelada, usersById = new Map()) {
  if ((pelada.votingStatus || 'CLOSED') !== 'FINISHED') {
    return {
      totalBallots: 0,
      top3: []
    };
  }

  if (pelada.craqueResult?.top3?.length) {
    return buildCraquePodiumFromSavedResult(pelada.craqueResult, usersById);
  }

  // Compatibilidade para peladas antigas sem snapshot salvo.
  const ranking = computeCraqueRanking(pelada.craqueVotes || []);
  return buildCraquePodiumFromRanking(ranking, usersById, (pelada.craqueVotes || []).length);
}

function refreshCraqueResultSnapshot(pelada) {
  pelada.craqueResult = buildCraqueResultSnapshot(pelada.craqueVotes || []);
}

function clearCraqueResultSnapshot(pelada) {
  pelada.craqueResult = null;
}

function formatRachaDateLabel(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('pt-BR', {
    timeZone: 'UTC'
  });
}

async function notifyPlayersSafely(fastify, userIds = [], notificationInput = {}) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return;
  }

  try {
    await sendPushNotificationToUsers(userIds, notificationInput);
  } catch (error) {
    fastify.log.error(error, 'Falha ao enviar notificacoes push.');
  }
}

export async function peladaRoutes(fastify) {
  fastify.get('/', { preHandler: [authenticate] }, async () => {
    const peladas = await Pelada.find({}, 'date type status votingStatus teams')
      .sort({ date: -1 })
      .lean();

    return peladas.map(formatPeladaSummary);
  });

  fastify.post(
    '/',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { date, type } = request.body || {};
      if (!date) {
        return reply.code(400).send({ message: 'Informe a data da pelada.' });
      }

      const normalizedType = String(type || 'NORMAL').toUpperCase();
      if (!['NORMAL', 'TOURNAMENT'].includes(normalizedType)) {
        return reply.code(400).send({ message: 'Tipo invalido. Use NORMAL ou TOURNAMENT.' });
      }

      const parsedDate = new Date(date);
      if (Number.isNaN(parsedDate.getTime())) {
        return reply.code(400).send({ message: 'Data invalida.' });
      }

      const pelada = await Pelada.create({
        date: parsedDate,
        type: normalizedType,
        createdBy: request.user.id,
        teams: [],
        tournamentMatches: [],
        playerStats: [],
        presenceOpenAt: null,
        presenceEntries: [],
        votes: [],
        craqueVotes: [],
        craqueResult: null,
        votingStatus: 'CLOSED',
        status: 'OPEN'
      });

      return reply.code(201).send(pelada.toJSON());
    }
  );

  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const canSeeRatings = canRequesterSeeRatings(request.user);
    const teamPlayerProjection = canSeeRatings
      ? 'name username role ratingAverage position stamina profileImageUrl'
      : 'name username role position profileImageUrl';

    const pelada = await Pelada.findById(request.params.id)
      .populate('teams.players', teamPlayerProjection)
      .populate('playerStats.player', 'name username')
      .populate('presenceEntries.user', 'name username profileImageUrl')
      .lean();

    if (!pelada) {
      return reply.code(404).send({ message: 'Pelada nao encontrada.' });
    }

    const participants = getParticipantIdSet(pelada);
    const participantIds = Array.from(participants);
    const users = await User.find({ _id: { $in: participantIds } }, 'name').lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const craquePodium = buildCraquePodiumForResponse(pelada, usersById);
    const selectionOfRound = buildSelectionOfRound(pelada);
    const isTournament = (pelada.type || 'NORMAL') === 'TOURNAMENT';
    const tournamentInfo = isTournament
      ? buildTournamentInfo(pelada.teams || [], pelada.tournamentMatches || [])
      : null;

    return {
      id: String(pelada._id),
      date: pelada.date,
      type: pelada.type || 'NORMAL',
      happened: new Date(pelada.date).getTime() <= Date.now(),
      status: pelada.status || 'OPEN',
      votingStatus: pelada.votingStatus,
      teams: (pelada.teams || []).map((team) => ({
        id: String(team._id),
        name: team.name,
        goalkeepers: team.goalkeepers || [],
        guestPlayers: (team.guestPlayers || []).map((guest) => ({
          name: guest.name,
          position: guest.position
        })),
        wins: team.wins || 0,
        draws: team.draws || 0,
        losses: team.losses || 0,
        players: (team.players || []).map((player) => ({
          id: String(player._id),
          name: player.name,
          username: player.username,
          role: player.role,
          profileImageUrl: player.profileImageUrl || null,
          ...(canSeeRatings ? { ratingAverage: player.ratingAverage } : {}),
          position: player.position,
          ...(canSeeRatings ? { stamina: player.stamina || 'MEDIA' } : {})
        }))
      })),
      playerStats: (pelada.playerStats || []).map((stat) => ({
        playerId: String(stat.player?._id || stat.player),
        playerName: stat.player?.name,
        goals: stat.goals || 0,
        assists: stat.assists || 0
      })),
      drawDraft: canSeeRatings && pelada.drawDraft
        ? {
            teamCount: Number(pelada.drawDraft.teamCount || 4),
            playerIds: (pelada.drawDraft.playerIds || []).map((item) => String(item)),
            guestPlayers: (pelada.drawDraft.guestPlayers || []).map((guest) => ({
              name: String(guest?.name || '').trim(),
              rating: Number(guest?.rating || 0),
              position: guest?.position || null,
              stamina: guest?.stamina || 'MEDIA'
            })),
            updatedAt: pelada.drawDraft.updatedAt || null
          }
        : null,
      presence: buildPresenceInfoForResponse(pelada, request.user.id),
      votesCount: (pelada.votes || []).length,
      tournament: tournamentInfo,
      craquePodium,
      selectionOfRound
    };
  });

  fastify.patch(
    '/:id/teams/draw',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { playerIds, teamCount, guestPlayers } = request.body || {};
      if (!Array.isArray(playerIds)) {
        return reply.code(400).send({ message: 'Informe a lista de jogadores para o sorteio.' });
      }
      if (guestPlayers !== undefined && !Array.isArray(guestPlayers)) {
        return reply.code(400).send({ message: 'A lista de convidados do sorteio deve ser um array.' });
      }

      const parsedTeamCount = Number(teamCount);
      if (!Number.isInteger(parsedTeamCount) || parsedTeamCount < 2 || parsedTeamCount > 4) {
        return reply.code(400).send({ message: 'O sorteio deve ter entre 2 e 4 times.' });
      }

      const normalizedPlayerIds = playerIds
        .map((playerId) => String(playerId || '').trim())
        .filter(Boolean);
      const uniquePlayerIds = Array.from(new Set(normalizedPlayerIds));
      if (uniquePlayerIds.length !== normalizedPlayerIds.length) {
        return reply
          .code(400)
          .send({ message: 'Um mesmo jogador nao pode ser informado duas vezes no sorteio.' });
      }

      const validPositions = new Set(['ZAGUEIRO', 'MEIA', 'ATACANTE']);
      const validStaminas = new Set(['BAIXA', 'MEDIA', 'ALTA']);
      let normalizedGuestPlayers = [];
      try {
        normalizedGuestPlayers = (guestPlayers || []).map((guest, index) => {
          const guestName = String(guest?.name || '')
            .trim()
            .replace(/\s+/g, ' ');
          const guestRating = Number(guest?.rating);
          const normalizedPosition = String(guest?.position || '')
            .trim()
            .toUpperCase();
          const normalizedStamina = String(guest?.stamina || 'MEDIA')
            .trim()
            .toUpperCase();

          if (!guestName) {
            throw new Error(`Informe o nome do convidado ${index + 1} no sorteio.`);
          }
          if (!Number.isFinite(guestRating) || guestRating < 1 || guestRating > 5) {
            throw new Error(`A nota do convidado ${guestName} deve estar entre 1 e 5.`);
          }
          if (normalizedPosition && !validPositions.has(normalizedPosition)) {
            throw new Error(
              `A posição do convidado ${guestName} é inválida. Use ZAGUEIRO, MEIA ou ATACANTE.`
            );
          }
          if (!validStaminas.has(normalizedStamina)) {
            throw new Error(`A stamina do convidado ${guestName} é inválida. Use BAIXA, MEDIA ou ALTA.`);
          }

          return {
            id: `guest-${index + 1}-${Date.now()}`,
            name: guestName,
            rating: Number(guestRating.toFixed(2)),
            position: normalizedPosition || null,
            stamina: normalizedStamina,
            isGuest: true
          };
        });
      } catch (error) {
        return reply.code(400).send({ message: error.message || 'Dados inválidos nos convidados do sorteio.' });
      }

      if (uniquePlayerIds.length + normalizedGuestPlayers.length === 0) {
        return reply.code(400).send({ message: 'Selecione ao menos 1 jogador ou convidado para o sorteio.' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      const players = await User.find(
        {
          _id: { $in: uniquePlayerIds },
          role: 'JOGADOR',
          $or: [{ approvalStatus: 'APPROVED' }, { approvalStatus: { $exists: false } }]
        },
        'name ratingAverage initialRating position stamina'
      ).lean();

      if (players.length !== uniquePlayerIds.length) {
        return reply.code(400).send({
          message: 'Um ou mais jogadores informados não existem, não são JOGADOR ou não estão aprovados.'
        });
      }

      const playersById = new Map(players.map((player) => [String(player._id), player]));
      const orderedPlayers = uniquePlayerIds.map((playerId) => playersById.get(playerId)).filter(Boolean);

      let drawResult;
      try {
        const registeredDrawPlayers = orderedPlayers.map((player) => ({
          id: String(player._id),
          name: player.name,
          rating:
            Number.isFinite(Number(player.ratingAverage)) && Number(player.ratingAverage) > 0
              ? Number(player.ratingAverage)
              : Number(player.initialRating || 3),
          position: player.position || null,
          stamina: player.stamina || 'MEDIA',
          isGuest: false
        }));

        drawResult = drawBalancedTeams(
          [...registeredDrawPlayers, ...normalizedGuestPlayers],
          parsedTeamCount,
          {
            maxPlayersPerTeam: 5
          }
        );
      } catch (error) {
        return reply.code(400).send({ message: error.message || 'Nao foi possivel gerar o sorteio.' });
      }

      pelada.drawDraft = {
        teamCount: parsedTeamCount,
        playerIds: uniquePlayerIds,
        guestPlayers: normalizedGuestPlayers.map((guest) => ({
          name: String(guest.name || '')
            .trim()
            .replace(/\s+/g, ' '),
          rating: Number(guest.rating),
          position: guest.position || null,
          stamina: guest.stamina || 'MEDIA'
        })),
        updatedAt: new Date()
      };
      await pelada.save();

      return {
        message: 'Sorteio equilibrado gerado com sucesso.',
        teamCount: parsedTeamCount,
        selectedPlayers: uniquePlayerIds.length + normalizedGuestPlayers.length,
        teams: drawResult.teams,
        balance: drawResult.balance
      };
    }
  );

  fastify.patch(
    '/:id/teams',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { teams } = request.body || {};
      const shapeError = validateTeamsShape(teams);
      if (shapeError) {
        return reply.code(400).send({ message: shapeError });
      }

      const playerIds = Array.from(new Set(teams.flatMap((team) => team.players.map(String))));
      const validPlayers = await User.countDocuments({
        _id: { $in: playerIds },
        role: 'JOGADOR'
      });

      if (validPlayers !== playerIds.length) {
        return reply
          .code(400)
          .send({ message: 'Um ou mais jogadores informados nao existem ou nao sao JOGADOR.' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      pelada.teams = teams.map((team) => ({
        name: team.name.trim(),
        players: team.players,
        guestPlayers: Array.isArray(team.guestPlayers)
          ? team.guestPlayers.map((guest) => ({
              name: String(guest.name || '').trim(),
              position: String(guest.position || '')
                .trim()
                .toUpperCase()
            }))
          : [],
        goalkeepers: Array.isArray(team.goalkeepers)
          ? team.goalkeepers.map((goalkeeper) => String(goalkeeper).trim()).filter(Boolean)
          : [],
        wins: 0,
        draws: 0,
        losses: 0
      }));

      // Reconfigurar os times invalida votos e estatisticas da pelada.
      pelada.playerStats = [];
      pelada.votes = [];
      pelada.craqueVotes = [];
      clearCraqueResultSnapshot(pelada);
      pelada.votingStatus = 'CLOSED';

      if ((pelada.type || 'NORMAL') === 'TOURNAMENT') {
        pelada.tournamentMatches = generateDoubleRoundRobinMatches(pelada.teams);
        syncTeamResultsFromMatches(pelada.teams, pelada.tournamentMatches);
      } else {
        pelada.tournamentMatches = [];
      }

      await pelada.save();
      await recalculateAllUsersStats();

      const allApprovedPlayers = await User.find(
        {
          role: 'JOGADOR',
          $or: [{ approvalStatus: 'APPROVED' }, { approvalStatus: { $exists: false } }]
        },
        '_id'
      ).lean();
      const notificationDateLabel = formatRachaDateLabel(pelada.date);
      await notifyPlayersSafely(
        fastify,
        allApprovedPlayers.map((item) => String(item._id)),
        {
          title: 'Times do racha confirmados',
          body: notificationDateLabel
            ? `A escalação do racha de ${notificationDateLabel} foi confirmada pelo ADM.`
            : 'A escalação do racha foi confirmada pelo ADM.',
          url: `/peladas/${String(pelada._id)}`
        }
      );

      return {
        id: String(pelada._id),
        message: 'Times atualizados com sucesso.'
      };
    }
  );

  fastify.patch(
    '/:id/results',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { results } = request.body || {};
      if (!Array.isArray(results)) {
        return reply.code(400).send({ message: 'Informe a lista de resultados por time.' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      if ((pelada.type || 'NORMAL') === 'TOURNAMENT') {
        return reply.code(400).send({
          message: 'Para torneio, os resultados sao calculados automaticamente pelos placares dos confrontos.'
        });
      }

      if (!pelada.teams || pelada.teams.length === 0) {
        return reply
          .code(400)
          .send({ message: 'Cadastre os times antes de informar resultados.' });
      }

      if (results.length !== pelada.teams.length) {
        return reply
          .code(400)
          .send({ message: 'Envie o resultado para todos os times da pelada.' });
      }

      const resultMap = new Map();
      for (const item of results) {
        if (!item.teamId) {
          return reply.code(400).send({ message: 'Cada resultado precisa de teamId.' });
        }

        const wins = Number(item.wins || 0);
        const draws = Number(item.draws || 0);
        const losses = Number(item.losses || 0);

        if (
          [wins, draws, losses].some(
            (value) => Number.isNaN(value) || !Number.isInteger(value) || value < 0 || value > 10
          )
        ) {
          return reply
            .code(400)
            .send({ message: 'Vitorias, empates e derrotas devem ser inteiros entre 0 e 10.' });
        }

        resultMap.set(String(item.teamId), { wins, draws, losses });
      }

      for (const team of pelada.teams) {
        const result = resultMap.get(String(team._id));
        if (!result) {
          return reply
            .code(400)
            .send({ message: `Resultado ausente para o time ${team.name}.` });
        }

        team.wins = result.wins;
        team.draws = result.draws;
        team.losses = result.losses;
      }

      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Resultados da pelada atualizados.' };
    }
  );

  fastify.patch(
    '/:id/tournament-matches/:matchId',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { matchId, id } = request.params;
      const { homeGoals, awayGoals } = request.body || {};

      const parsedHomeGoals = Number(homeGoals);
      const parsedAwayGoals = Number(awayGoals);

      if (
        !Number.isInteger(parsedHomeGoals) ||
        !Number.isInteger(parsedAwayGoals) ||
        parsedHomeGoals < 0 ||
        parsedAwayGoals < 0
      ) {
        return reply.code(400).send({
          message: 'Informe homeGoals e awayGoals como inteiros >= 0.'
        });
      }

      const pelada = await Pelada.findById(id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      if ((pelada.type || 'NORMAL') !== 'TOURNAMENT') {
        return reply.code(400).send({
          message: 'Este endpoint e exclusivo para rachas do tipo torneio.'
        });
      }

      const match = (pelada.tournamentMatches || []).find((item) => String(item._id) === String(matchId));
      if (!match) {
        return reply.code(404).send({ message: 'Confronto nao encontrado.' });
      }

      match.homeGoals = parsedHomeGoals;
      match.awayGoals = parsedAwayGoals;

      syncTeamResultsFromMatches(pelada.teams, pelada.tournamentMatches);

      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Placar atualizado com sucesso.' };
    }
  );

  fastify.patch(
    '/:id/player-stats',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { stats } = request.body || {};

      if (!Array.isArray(stats)) {
        return reply
          .code(400)
          .send({ message: 'Informe uma lista de estatisticas de jogadores.' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      const participants = getParticipantIdSet(pelada);
      if (participants.size === 0) {
        return reply
          .code(400)
          .send({ message: 'Cadastre os times antes de inserir estatisticas.' });
      }

      const seen = new Set();
      const parsedStats = [];

      for (const item of stats) {
        const playerId = String(item.playerId || '');
        const goals = Number(item.goals || 0);
        const assists = Number(item.assists || 0);

        if (!playerId) {
          return reply.code(400).send({ message: 'Cada item deve conter playerId.' });
        }

        if (!participants.has(playerId)) {
          return reply
            .code(400)
            .send({ message: 'Todos os jogadores das estatisticas devem estar na pelada.' });
        }

        if (seen.has(playerId)) {
          return reply
            .code(400)
            .send({ message: 'Um jogador nao pode ter estatistica duplicada na mesma pelada.' });
        }

        if (
          [goals, assists].some(
            (value) => Number.isNaN(value) || !Number.isInteger(value) || value < 0 || value > 15
          )
        ) {
          return reply
            .code(400)
            .send({ message: 'Gols e assistencias devem ser numeros inteiros entre 0 e 15.' });
        }

        seen.add(playerId);
        parsedStats.push({
          player: playerId,
          goals,
          assists
        });
      }

      pelada.playerStats = parsedStats;
      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Estatisticas de jogadores atualizadas.' };
    }
  );

  fastify.post(
    '/:id/voting/open',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      if (!pelada.teams || pelada.teams.length === 0) {
        return reply
          .code(400)
          .send({ message: 'Cadastre os times da pelada antes de abrir votacao.' });
      }

      pelada.votingStatus = 'OPEN';
      clearCraqueResultSnapshot(pelada);
      await pelada.save();

      const participants = getParticipantIdSet(pelada);
      const notificationDateLabel = formatRachaDateLabel(pelada.date);
      await notifyPlayersSafely(fastify, Array.from(participants), {
        title: 'Votação liberada',
        body: notificationDateLabel
          ? `As notas do racha de ${notificationDateLabel} já estão abertas.`
          : 'As notas deste racha já estão abertas.',
        url: `/peladas/${String(pelada._id)}`
      });

      return { message: 'Votacao aberta para esta pelada.' };
    }
  );

  fastify.post(
    '/:id/voting/finish',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      pelada.votingStatus = 'FINISHED';
      refreshCraqueResultSnapshot(pelada);
      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Votacao finalizada para esta pelada.' };
    }
  );

  fastify.post(
    '/:id/conclude',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }

      if (isConcluded(pelada)) {
        return { message: 'Racha ja estava concluido.' };
      }

      pelada.status = 'CONCLUDED';
      pelada.votingStatus = 'FINISHED';
      refreshCraqueResultSnapshot(pelada);
      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Racha concluido com sucesso.' };
    }
  );

  fastify.patch(
    '/:id/presence/config',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { openAt } = request.body || {};
      if (!openAt) {
        return reply.code(400).send({ message: 'Informe a data e horário de abertura da presença.' });
      }

      const parsedOpenAt = new Date(openAt);
      if (Number.isNaN(parsedOpenAt.getTime())) {
        return reply.code(400).send({ message: 'Data/hora de presença inválida.' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }

      if (!isPresenceEligibleRacha(pelada)) {
        return reply.code(409).send({
          message: 'A presença só pode ser configurada em rachas abertos que ainda não aconteceram.'
        });
      }

      if (parsedOpenAt.getTime() > new Date(pelada.date).getTime()) {
        return reply.code(400).send({
          message: 'A abertura da presença deve acontecer antes da data do racha.'
        });
      }

      pelada.presenceOpenAt = parsedOpenAt;
      await pelada.save();

      return {
        message: 'Abertura de presença configurada com sucesso.',
        openAt: pelada.presenceOpenAt
      };
    }
  );

  fastify.post('/:id/presence/confirm', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem marcar presença.' });
    }

    const now = new Date();
    const peladaId = String(request.params.id);
    const currentUserId = String(request.user.id);

    const updatedPelada = await Pelada.findOneAndUpdate(
      {
        _id: peladaId,
        status: 'OPEN',
        date: { $gt: now },
        presenceOpenAt: { $ne: null, $lte: now },
        'presenceEntries.user': { $ne: currentUserId }
      },
      {
        $push: {
          presenceEntries: {
            user: currentUserId,
            markedAt: now
          }
        }
      },
      { new: true }
    ).lean();

    if (!updatedPelada) {
      const pelada = await Pelada.findById(peladaId).lean();
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }

      if (!isPresenceEligibleRacha(pelada)) {
        return reply.code(409).send({
          message: 'Este racha não está disponível para marcação de presença.'
        });
      }

      if (!pelada.presenceOpenAt) {
        return reply.code(400).send({
          message: 'O ADM ainda não configurou a abertura da presença.'
        });
      }

      if (!isPresenceWindowOpen(pelada)) {
        return reply.code(400).send({
          message: 'A presença ainda não foi liberada para este racha.'
        });
      }

      const alreadyMarked = (pelada.presenceEntries || []).some(
        (entry) => String(entry.user) === currentUserId
      );
      if (alreadyMarked) {
        return reply.code(409).send({
          message: 'Você já marcou presença para este racha.'
        });
      }

      return reply.code(409).send({ message: 'Não foi possível marcar presença agora. Tente novamente.' });
    }

    const sortedEntries = sortPresenceEntries(updatedPelada.presenceEntries || []);
    const order = sortedEntries.findIndex((entry) => String(entry.user) === currentUserId) + 1;
    const isWaitingList = order > PRESENCE_LIMIT;

    return reply.code(201).send({
      message: isWaitingList
        ? 'Presença marcada. Você está na lista de espera.'
        : 'Presença marcada. Você está entre os 20 primeiros.',
      order,
      isWaitingList
    });
  });

  fastify.delete('/:id/presence/confirm', { preHandler: [authenticate] }, async (request, reply) => {
    if (request.user.role !== 'JOGADOR') {
      return reply.code(403).send({ message: 'Apenas jogadores podem desistir da presença.' });
    }

    const now = new Date();
    const peladaId = String(request.params.id);
    const currentUserId = String(request.user.id);

    const updatedPelada = await Pelada.findOneAndUpdate(
      {
        _id: peladaId,
        status: 'OPEN',
        date: { $gt: now },
        'presenceEntries.user': currentUserId
      },
      {
        $pull: {
          presenceEntries: {
            user: currentUserId
          }
        }
      },
      { new: true }
    ).lean();

    if (!updatedPelada) {
      const pelada = await Pelada.findById(peladaId).lean();
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }

      if (!isPresenceEligibleRacha(pelada)) {
        return reply.code(409).send({
          message: 'Este racha não está disponível para controle de presença.'
        });
      }

      return reply.code(404).send({
        message: 'Você não está marcado na presença deste racha.'
      });
    }

    return {
      message: 'Você desistiu do racha. Sua presença foi removida.'
    };
  });

  fastify.post('/:id/votes', { preHandler: [authenticate] }, async (request, reply) => {
    const { toUserId, score } = request.body || {};
    const fromUserId = String(request.user.id);

    const numericScore = Number(score);
    if (!toUserId || !isHalfStepScore(numericScore)) {
      return reply
        .code(400)
        .send({ message: 'Informe toUserId e score valido entre 0.5 e 5.0 (passo 0.5).' });
    }

    const pelada = await Pelada.findById(request.params.id);
    if (!pelada) {
      return reply.code(404).send({ message: 'Pelada nao encontrada.' });
    }
    if (!ensureEditableRacha(pelada, reply)) {
      return;
    }

    if (pelada.votingStatus !== 'OPEN') {
      return reply.code(400).send({ message: 'A votacao desta pelada nao esta aberta.' });
    }

    const participants = getParticipantIdSet(pelada);
    const targetId = String(toUserId);

    if (!participants.has(fromUserId)) {
      return reply
        .code(403)
        .send({ message: 'Apenas jogadores participantes da pelada podem votar.' });
    }

    if (!participants.has(targetId)) {
      return reply.code(400).send({ message: 'O jogador avaliado deve participar da pelada.' });
    }

    if (fromUserId === targetId) {
      return reply.code(400).send({ message: 'Nao e permitido votar em si mesmo.' });
    }

    const alreadyVoted = pelada.votes.some(
      (vote) => String(vote.fromUser) === fromUserId && String(vote.toUser) === targetId
    );

    if (alreadyVoted) {
      return reply
        .code(409)
        .send({ message: 'Voce ja votou neste jogador para esta pelada.' });
    }

    pelada.votes.push({
      fromUser: fromUserId,
      toUser: targetId,
      score: numericScore
    });

    await pelada.save();

    return reply.code(201).send({ message: 'Nota registrada com sucesso.' });
  });

  fastify.post('/:id/craque-vote', { preHandler: [authenticate] }, async (request, reply) => {
    const { firstUserId, secondUserId, thirdUserId } = request.body || {};
    const fromUserId = String(request.user.id);

    if (!firstUserId || !secondUserId || !thirdUserId) {
      return reply.code(400).send({
        message: 'Informe os 3 colocados do craque do racha.'
      });
    }

    const picks = [String(firstUserId), String(secondUserId), String(thirdUserId)];
    if (new Set(picks).size !== 3) {
      return reply.code(400).send({
        message: 'Os colocados de craque do racha devem ser jogadores diferentes.'
      });
    }

    if (picks.includes(fromUserId)) {
      return reply.code(400).send({
        message: 'Nao e permitido colocar a si mesmo no podio de craque.'
      });
    }

    const pelada = await Pelada.findById(request.params.id);
    if (!pelada) {
      return reply.code(404).send({ message: 'Pelada nao encontrada.' });
    }
    if (!ensureEditableRacha(pelada, reply)) {
      return;
    }

    if (pelada.votingStatus !== 'OPEN') {
      return reply.code(400).send({ message: 'A votacao desta pelada nao esta aberta.' });
    }

    const participants = getParticipantIdSet(pelada);
    if (!participants.has(fromUserId)) {
      return reply
        .code(403)
        .send({ message: 'Apenas jogadores participantes da pelada podem votar.' });
    }

    const hasInvalidPick = picks.some((pickId) => !participants.has(pickId));
    if (hasInvalidPick) {
      return reply.code(400).send({
        message: 'Todos os jogadores do podio devem participar da pelada.'
      });
    }

    const existingVote = pelada.craqueVotes.find((vote) => String(vote.fromUser) === fromUserId);
    if (existingVote) {
      existingVote.firstUser = String(firstUserId);
      existingVote.secondUser = String(secondUserId);
      existingVote.thirdUser = String(thirdUserId);
    } else {
      pelada.craqueVotes.push({
        fromUser: fromUserId,
        firstUser: String(firstUserId),
        secondUser: String(secondUserId),
        thirdUser: String(thirdUserId)
      });
    }

    await pelada.save();

    return reply.code(201).send({ message: 'Podio de craque registrado com sucesso.' });
  });

  fastify.get(
    '/:id/votes/details',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const pelada = await Pelada.findById(request.params.id)
        .populate('votes.fromUser', 'name username')
        .populate('votes.toUser', 'name username')
        .lean();

      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }

      const votes = (pelada.votes || [])
        .map((vote) => ({
          voteId: vote._id ? String(vote._id) : `${vote.fromUser}-${vote.toUser}`,
          fromUserId: String(vote.fromUser?._id || vote.fromUser),
          fromUserName: vote.fromUser?.name || 'Jogador removido',
          toUserId: String(vote.toUser?._id || vote.toUser),
          toUserName: vote.toUser?.name || 'Jogador removido',
          score: Number(vote.score || 0),
          createdAt: vote.createdAt,
          updatedAt: vote.updatedAt
        }))
        .sort((a, b) => {
          const targetCompare = a.toUserName.localeCompare(b.toUserName);
          if (targetCompare !== 0) return targetCompare;
          return a.fromUserName.localeCompare(b.fromUserName);
        });

      return {
        peladaId: String(pelada._id),
        status: pelada.status || 'OPEN',
        votingStatus: pelada.votingStatus,
        votes
      };
    }
  );

  fastify.patch(
    '/:id/votes/admin-edit',
    {
      preHandler: [authenticate, authorize('ADM')]
    },
    async (request, reply) => {
      const { fromUserId, toUserId, score } = request.body || {};
      const numericScore = Number(score);

      if (!fromUserId || !toUserId || !isHalfStepScore(numericScore)) {
        return reply
          .code(400)
          .send({ message: 'Informe fromUserId, toUserId e score valido entre 0.5 e 5.0 (passo 0.5).' });
      }

      const pelada = await Pelada.findById(request.params.id);
      if (!pelada) {
        return reply.code(404).send({ message: 'Pelada nao encontrada.' });
      }
      if (!ensureEditableRacha(pelada, reply)) {
        return;
      }

      const targetVote = pelada.votes.find(
        (vote) =>
          String(vote.fromUser) === String(fromUserId) && String(vote.toUser) === String(toUserId)
      );

      if (!targetVote) {
        return reply.code(404).send({ message: 'Voto nao encontrado para este par de jogadores.' });
      }

      targetVote.score = numericScore;

      await pelada.save();
      await recalculateAllUsersStats();

      return { message: 'Nota atualizada com sucesso.' };
    }
  );

  fastify.get('/:id/rating-cards', { preHandler: [authenticate] }, async (request, reply) => {
    const canSeeRatings = canRequesterSeeRatings(request.user);
    const pelada = await Pelada.findById(request.params.id).lean();
    if (!pelada) {
      return reply.code(404).send({ message: 'Pelada nao encontrada.' });
    }

    const participants = getParticipantIdSet(pelada);
    const participantIds = Array.from(participants);

    const users = await User.find(
      { _id: { $in: participantIds } },
      canSeeRatings
        ? 'name username profileImageUrl ratingAverage totalGoals totalAssists totalWins totalDraws totalLosses'
        : 'name username profileImageUrl totalGoals totalAssists totalWins totalDraws totalLosses'
    ).lean();

    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const statsByPlayer = buildPlayerStatsMap(pelada.playerStats);
    const teamResultByPlayer = buildTeamResultByPlayer(pelada.teams);

    const votedByMe = new Set(
      (pelada.votes || [])
        .filter((vote) => String(vote.fromUser) === String(request.user.id))
        .map((vote) => String(vote.toUser))
    );

    const myCraqueVote = (pelada.craqueVotes || []).find(
      (vote) => String(vote.fromUser) === String(request.user.id)
    );

    const canCurrentUserVote =
      !isConcluded(pelada) &&
      pelada.votingStatus === 'OPEN' &&
      participants.has(String(request.user.id));
    const canCurrentUserVoteCraque = canCurrentUserVote;
    const currentUserId = String(request.user.id);
    const votesReceivedByCurrentUser = (pelada.votes || [])
      .filter((vote) => String(vote.toUser) === currentUserId)
      .map((vote) => Number(vote.score || 0));

    const myMatchRating = summarizeRachaRatings(votesReceivedByCurrentUser).average;

    const cards = participantIds
      .map((participantId) => {
        const user = usersById.get(participantId);
        if (!user) return null;

        const playerStats = statsByPlayer.get(participantId) || { goals: 0, assists: 0 };
        const teamResult = teamResultByPlayer.get(participantId) || {
          wins: 0,
          draws: 0,
          losses: 0
        };

        return {
          playerId: participantId,
          name: user.name,
          username: user.username,
          profileImageUrl: user.profileImageUrl || null,
          ...(canSeeRatings ? { ratingAverage: user.ratingAverage } : {}),
          matchGoals: playerStats.goals,
          matchAssists: playerStats.assists,
          matchWins: teamResult.wins,
          matchDraws: teamResult.draws,
          matchLosses: teamResult.losses,
          alreadyRatedByMe: votedByMe.has(participantId),
          canVote:
            canCurrentUserVote &&
            participantId !== String(request.user.id) &&
            !votedByMe.has(participantId)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      peladaId: String(pelada._id),
      status: pelada.status || 'OPEN',
      votingStatus: pelada.votingStatus,
      canCurrentUserVote,
      canCurrentUserVoteCraque,
      myMatchRating,
      myCraqueVote: myCraqueVote
        ? {
            firstUserId: String(myCraqueVote.firstUser),
            secondUserId: String(myCraqueVote.secondUser),
            thirdUserId: String(myCraqueVote.thirdUser)
          }
        : null,
      cards
    };
  });
}
