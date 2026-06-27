import { summarizeRachaRatings } from './rating-average.js';

const VALID_POSITIONS = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];

function toIdString(value) {
  return String(value?._id || value?.id || value || '');
}

function playerName(player) {
  return String(player?.name || 'Jogador removido');
}

function compareCandidates(left, right) {
  if (right.average !== left.average) return right.average - left.average;
  if (right.votesCount !== left.votesCount) return right.votesCount - left.votesCount;
  return playerName(left).localeCompare(playerName(right), 'pt-BR');
}

function topByPosition(candidates, position, limit) {
  return candidates.filter((candidate) => candidate.position === position).slice(0, limit);
}

function uniquePlayers(players) {
  const seen = new Set();
  const result = [];

  for (const player of players) {
    if (!player?.id || seen.has(player.id)) {
      continue;
    }

    seen.add(player.id);
    result.push(player);
  }

  return result;
}

function countPositions(players) {
  return players.reduce(
    (acc, player) => {
      if (VALID_POSITIONS.includes(player.position)) {
        acc[player.position] += 1;
      }
      return acc;
    },
    { ZAGUEIRO: 0, MEIA: 0, ATACANTE: 0 }
  );
}

function balanceMiddleAndAttack(selected, candidates) {
  if (selected.length < 3) {
    return selected;
  }

  const positions = new Set(selected.map((player) => player.position));
  if (positions.size > 1) {
    return selected;
  }

  const repeatedPosition = selected[0]?.position;
  const alternative = candidates.find(
    (candidate) =>
      candidate.position !== repeatedPosition &&
      !selected.some((player) => player.id === candidate.id)
  );

  if (!alternative) {
    return selected;
  }

  return [...selected.slice(0, 2), alternative];
}

function fillToFive(selected, candidates) {
  const selectedIds = new Set(selected.map((player) => player.id));
  const result = [...selected];

  for (const candidate of candidates) {
    if (result.length >= 5) {
      break;
    }

    if (selectedIds.has(candidate.id)) {
      continue;
    }

    selectedIds.add(candidate.id);
    result.push(candidate);
  }

  return result;
}

function enforceMinimumPositions(selected, candidates) {
  const availablePositions = VALID_POSITIONS.filter((position) =>
    candidates.some((candidate) => candidate.position === position)
  );
  let result = [...selected];

  for (const position of availablePositions) {
    if (result.some((player) => player.position === position)) {
      continue;
    }

    const candidate = candidates.find(
      (item) => item.position === position && !result.some((player) => player.id === item.id)
    );
    if (!candidate) {
      continue;
    }

    if (result.length < 5) {
      result.push(candidate);
      continue;
    }

    const counts = countPositions(result);
    const replaceableIndex = result
      .map((player, index) => ({ player, index }))
      .filter((item) => item.player.position !== position && counts[item.player.position] > 1)
      .sort((left, right) => {
        if (left.player.average !== right.player.average) {
          return left.player.average - right.player.average;
        }
        return right.index - left.index;
      })[0]?.index;

    if (replaceableIndex !== undefined) {
      result[replaceableIndex] = candidate;
    }
  }

  return uniquePlayers(result).sort(compareCandidates).slice(0, 5);
}

function toSelectionPlayer(candidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    username: candidate.username,
    profileImageUrl: candidate.profileImageUrl || null,
    position: candidate.position
  };
}

export function buildSelectionOfRound(pelada) {
  if ((pelada?.votingStatus || 'CLOSED') !== 'FINISHED') {
    return null;
  }

  const participantsById = new Map();
  for (const team of pelada?.teams || []) {
    for (const player of team?.players || []) {
      const playerId = toIdString(player);
      if (!playerId || participantsById.has(playerId)) {
        continue;
      }

      const position = player?.position;
      if (!VALID_POSITIONS.includes(position)) {
        continue;
      }

      participantsById.set(playerId, {
        id: playerId,
        name: playerName(player),
        username: String(player?.username || ''),
        profileImageUrl: player?.profileImageUrl || null,
        position
      });
    }
  }

  const voteStats = new Map();
  for (const vote of pelada?.votes || []) {
    const targetId = toIdString(vote?.toUser);
    const score = Number(vote?.score);
    if (!participantsById.has(targetId) || !Number.isFinite(score)) {
      continue;
    }

    const current = voteStats.get(targetId) || [];
    current.push(score);
    voteStats.set(targetId, current);
  }

  const candidates = Array.from(participantsById.values())
    .map((player) => {
      const rating = summarizeRachaRatings(voteStats.get(player.id) || []);
      if (rating.count <= 0) {
        return null;
      }

      return {
        ...player,
        average: rating.average,
        votesCount: rating.count
      };
    })
    .filter(Boolean)
    .sort(compareCandidates);

  if (candidates.length < 5) {
    return {
      isAvailable: false,
      totalEligible: candidates.length,
      players: []
    };
  }

  const defenders = topByPosition(candidates, 'ZAGUEIRO', 2);
  const middleAndAttackCandidates = candidates.filter(
    (candidate) => candidate.position === 'MEIA' || candidate.position === 'ATACANTE'
  );
  const middleAndAttack = balanceMiddleAndAttack(
    middleAndAttackCandidates.slice(0, 3),
    middleAndAttackCandidates
  );

  let selected = uniquePlayers([...defenders, ...middleAndAttack]);
  selected = fillToFive(selected, candidates);
  selected = enforceMinimumPositions(selected, candidates);

  const requiredPositions = VALID_POSITIONS.filter((position) =>
    candidates.some((candidate) => candidate.position === position)
  );
  const hasRequiredPositions = requiredPositions.every((position) =>
    selected.some((player) => player.position === position)
  );

  if (selected.length < 5 || !hasRequiredPositions) {
    return {
      isAvailable: false,
      totalEligible: candidates.length,
      players: []
    };
  }

  return {
    isAvailable: true,
    totalEligible: candidates.length,
    players: selected.map(toSelectionPlayer)
  };
}
