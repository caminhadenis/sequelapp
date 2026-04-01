import { Pelada } from '../models/Pelada.js';
import { User } from '../models/User.js';
import { buildTournamentInfo } from '../utils/tournament.js';

function toIdString(id) {
  return String(id);
}

const CRAQUE_WEIGHTS = {
  firstUser: 5,
  secondUser: 3,
  thirdUser: 1
};

function computeCraqueTop3FromVotes(craqueVotes = []) {
  const ranking = new Map();

  function ensurePlayer(playerId) {
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
    const firstId = toIdString(vote.firstUser);
    const secondId = toIdString(vote.secondUser);
    const thirdId = toIdString(vote.thirdUser);

    const first = ensurePlayer(firstId);
    const second = ensurePlayer(secondId);
    const third = ensurePlayer(thirdId);

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
    .slice(0, 3)
    .map((item, index) => ({
      ...item,
      position: index + 1
    }));
}

function applyFinalCraqueTop3Stats(totals, top3 = []) {
  for (const item of top3) {
    const stat = totals.get(toIdString(item.player));
    if (!stat) continue;

    stat.totalCraquePoints += Number(item.points || 0);

    const position = Number(item.position || 0);
    if (position === 1) {
      stat.totalCraqueFirstPlaces += 1;
    } else if (position === 2) {
      stat.totalCraqueSecondPlaces += 1;
    } else if (position === 3) {
      stat.totalCraqueThirdPlaces += 1;
    }
  }
}

export async function recalculateAllUsersStats() {
  const users = await User.find({}, '_id initialRating').lean();

  const totals = new Map();
  const ratings = new Map();

  for (const user of users) {
    const key = toIdString(user._id);
    totals.set(key, {
      totalGoals: 0,
      totalAssists: 0,
      totalWins: 0,
      totalDraws: 0,
      totalLosses: 0,
      totalCraquePoints: 0,
      totalCraqueFirstPlaces: 0,
      totalCraqueSecondPlaces: 0,
      totalCraqueThirdPlaces: 0,
      totalTournamentTitles: 0,
      initialRating: Number(user.initialRating || 3)
    });
    ratings.set(key, {
      sum: 0,
      count: 0
    });
  }

  const peladas = await Pelada.find(
    {},
    'type votingStatus teams tournamentMatches playerStats votes craqueVotes craqueResult'
  ).lean();

  for (const pelada of peladas) {
    for (const team of pelada.teams || []) {
      for (const playerId of team.players || []) {
        const key = toIdString(playerId);
        const stat = totals.get(key);
        if (!stat) continue;

        stat.totalWins += Number(team.wins || 0);
        stat.totalDraws += Number(team.draws || 0);
        stat.totalLosses += Number(team.losses || 0);
      }
    }

    for (const playerStat of pelada.playerStats || []) {
      const key = toIdString(playerStat.player);
      const stat = totals.get(key);
      if (!stat) continue;

      stat.totalGoals += Number(playerStat.goals || 0);
      stat.totalAssists += Number(playerStat.assists || 0);
    }

    for (const vote of pelada.votes || []) {
      const key = toIdString(vote.toUser);
      const rating = ratings.get(key);
      if (!rating) continue;

      rating.sum += Number(vote.score || 0);
      rating.count += 1;
    }

    if ((pelada.votingStatus || 'CLOSED') === 'FINISHED') {
      if (pelada.craqueResult?.top3?.length) {
        applyFinalCraqueTop3Stats(totals, pelada.craqueResult.top3);
      } else {
        // Compatibilidade com rachas antigos sem snapshot: calcula o pódio final a partir dos votos.
        const legacyTop3 = computeCraqueTop3FromVotes(pelada.craqueVotes || []).map((item) => ({
          player: item.playerId,
          points: item.points,
          position: item.position
        }));
        applyFinalCraqueTop3Stats(totals, legacyTop3);
      }
    }

    if ((pelada.type || 'NORMAL') === 'TOURNAMENT') {
      const tournamentInfo = buildTournamentInfo(pelada.teams || [], pelada.tournamentMatches || []);
      if (tournamentInfo?.isCompleted && tournamentInfo?.championTeamId) {
        const championTeam = (pelada.teams || []).find(
          (team) => toIdString(team._id) === tournamentInfo.championTeamId
        );

        for (const playerId of championTeam?.players || []) {
          const key = toIdString(playerId);
          const stat = totals.get(key);
          if (!stat) continue;
          stat.totalTournamentTitles += 1;
        }
      }
    }
  }

  const operations = [];

  for (const [userId, stat] of totals.entries()) {
    const rating = ratings.get(userId);
    const ratingAverage =
      rating && rating.count > 0
        ? Number((rating.sum / rating.count).toFixed(2))
        : stat.initialRating;

    operations.push({
      updateOne: {
        filter: { _id: userId },
        update: {
          $set: {
            totalGoals: stat.totalGoals,
            totalAssists: stat.totalAssists,
            totalWins: stat.totalWins,
            totalDraws: stat.totalDraws,
            totalLosses: stat.totalLosses,
            totalCraquePoints: stat.totalCraquePoints,
            totalCraqueFirstPlaces: stat.totalCraqueFirstPlaces,
            totalCraqueSecondPlaces: stat.totalCraqueSecondPlaces,
            totalCraqueThirdPlaces: stat.totalCraqueThirdPlaces,
            totalTournamentTitles: stat.totalTournamentTitles,
            ratingAverage
          }
        }
      }
    });
  }

  if (operations.length > 0) {
    await User.bulkWrite(operations);
  }
}
