const POSITION_ORDER = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];
const FALLBACK_ORDER = {
  ZAGUEIRO: ['MEIA', 'ATACANTE'],
  MEIA: ['ATACANTE', 'ZAGUEIRO'],
  ATACANTE: ['MEIA', 'ZAGUEIRO']
};
const STAMINA_ORDER = ['BAIXA', 'MEDIA', 'ALTA'];

function normalizedRating(player) {
  const rating = Number(player?.rating);
  if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
    return rating;
  }
  return 3;
}

function normalizePosition(position) {
  const normalized = String(position || '')
    .trim()
    .toUpperCase();
  return POSITION_ORDER.includes(normalized) ? normalized : null;
}

function normalizeStamina(stamina) {
  const normalized = String(stamina || '')
    .trim()
    .toUpperCase();
  return STAMINA_ORDER.includes(normalized) ? normalized : 'MEDIA';
}

function shuffle(items) {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
}

function cloneTeams(teams) {
  return teams.map((team) => team.slice());
}

function buildTeamCapacities(totalPlayers, teamCount) {
  const baseSize = Math.floor(totalPlayers / teamCount);
  const remainder = totalPlayers % teamCount;
  return Array.from({ length: teamCount }, (_, index) => baseSize + (index < remainder ? 1 : 0));
}

function buildSnakePickOrder(capacities) {
  const teamCount = capacities.length;
  const remaining = [...capacities];
  const totalSlots = capacities.reduce((sum, value) => sum + value, 0);
  const order = [];
  let direction = 1;

  while (order.length < totalSlots) {
    const indexes =
      direction === 1
        ? Array.from({ length: teamCount }, (_, index) => index)
        : Array.from({ length: teamCount }, (_, index) => teamCount - 1 - index);

    for (const teamIndex of indexes) {
      if (remaining[teamIndex] <= 0) {
        continue;
      }
      remaining[teamIndex] -= 1;
      order.push(teamIndex);
      if (order.length >= totalSlots) {
        break;
      }
    }

    direction *= -1;
  }

  return order;
}

function countPositions(teamPlayers) {
  const counts = {
    ZAGUEIRO: 0,
    MEIA: 0,
    ATACANTE: 0,
    FLEX: 0
  };

  for (const player of teamPlayers) {
    if (!player.position) {
      counts.FLEX += 1;
      continue;
    }
    counts[player.position] += 1;
  }

  return counts;
}

function countStamina(teamPlayers) {
  const counts = {
    BAIXA: 0,
    MEDIA: 0,
    ALTA: 0
  };

  for (const player of teamPlayers) {
    const normalized = normalizeStamina(player?.stamina);
    counts[normalized] += 1;
  }

  return counts;
}

function minimumDefendersPerTeam(totalDefenders, teamCount) {
  if (totalDefenders >= teamCount * 2) {
    return 2;
  }
  if (totalDefenders >= teamCount) {
    return 1;
  }
  return 0;
}

function missingPositionPenalty(role, counts) {
  const [firstFallback, secondFallback] = FALLBACK_ORDER[role];
  if (counts[firstFallback] > 0) {
    return 0.4;
  }
  if (counts[secondFallback] > 0) {
    return 0.85;
  }
  if (counts.FLEX > 0) {
    return 0.55;
  }
  return 1.25;
}

function teamPositionPenalty(teamPlayers, context) {
  if (!Array.isArray(teamPlayers) || teamPlayers.length === 0) {
    return 0;
  }

  const counts = countPositions(teamPlayers);
  let penalty = 0;
  const minimumDefenders = Math.min(Number(context?.minimumDefenders || 0), teamPlayers.length);

  if (counts.ZAGUEIRO < minimumDefenders) {
    const deficit = minimumDefenders - counts.ZAGUEIRO;
    const fallbackSupport = counts.MEIA + counts.FLEX;
    const deficitWeight = minimumDefenders >= 2 ? 2.35 : 1.35;
    penalty += deficit * (fallbackSupport > 0 ? deficitWeight : deficitWeight + 0.7);
  }

  if (teamPlayers.length >= 3) {
    for (const role of ['MEIA', 'ATACANTE']) {
      if (counts[role] > 0) {
        continue;
      }
      penalty += missingPositionPenalty(role, counts);
    }
  }

  for (const role of POSITION_ORDER) {
    if (role === 'ZAGUEIRO' && counts[role] > 2) {
      penalty += (counts[role] - 2) * 0.35;
    }

    if (role !== 'ZAGUEIRO' && counts[role] > 2) {
      penalty += (counts[role] - 2) * 0.45;
    }
  }

  return penalty;
}

function roleVariancePenalty(teams) {
  let penalty = 0;

  for (const role of POSITION_ORDER) {
    const counts = teams.map((team) => team.filter((player) => player.position === role).length);
    const average = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    const variance =
      counts.reduce((sum, value) => sum + (value - average) * (value - average), 0) / counts.length;
    penalty += Math.sqrt(variance);
  }

  return penalty;
}

function staminaVariancePenalty(teams) {
  if (!Array.isArray(teams) || teams.length === 0) {
    return 0;
  }

  const altaCounts = teams.map((team) => team.filter((player) => normalizeStamina(player.stamina) === 'ALTA').length);
  const baixaCounts = teams.map((team) => team.filter((player) => normalizeStamina(player.stamina) === 'BAIXA').length);

  function stdDev(values) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - average) * (value - average), 0) / values.length;
    return Math.sqrt(variance);
  }

  const altaStd = stdDev(altaCounts);
  const baixaStd = stdDev(baixaCounts);
  const altaSpread = Math.max(...altaCounts) - Math.min(...altaCounts);
  const baixaSpread = Math.max(...baixaCounts) - Math.min(...baixaCounts);

  return altaStd * 1.45 + baixaStd * 1.45 + altaSpread * 0.8 + baixaSpread * 0.8;
}

function calculateAssignmentCost(teams, context) {
  const teamAverages = teams.map((team) => {
    if (team.length === 0) {
      return 0;
    }
    const total = team.reduce((sum, player) => sum + player.rating, 0);
    return total / team.length;
  });

  const maxAverage = Math.max(...teamAverages);
  const minAverage = Math.min(...teamAverages);
  const averageOfAverages = teamAverages.reduce((sum, value) => sum + value, 0) / teamAverages.length;
  const stdDeviation = Math.sqrt(
    teamAverages.reduce((sum, value) => sum + (value - averageOfAverages) ** 2, 0) / teamAverages.length
  );
  const positionPenalty = teams.reduce((sum, team) => sum + teamPositionPenalty(team, context), 0);
  const variancePenalty = roleVariancePenalty(teams);
  const staminaPenalty = staminaVariancePenalty(teams);

  return {
    value:
      (maxAverage - minAverage) * 3.2 +
      stdDeviation * 2.1 +
      positionPenalty * 2.6 +
      variancePenalty * 1.1 +
      staminaPenalty * 1.9,
    spread: maxAverage - minAverage
  };
}

function createInitialAssignment(players, capacities) {
  const orderedPlayers = [...players].sort((a, b) => {
    if (b.rating !== a.rating) {
      return b.rating - a.rating;
    }
    return Math.random() < 0.5 ? -1 : 1;
  });

  const teams = capacities.map(() => []);
  const pickOrder = buildSnakePickOrder(capacities);

  for (let index = 0; index < orderedPlayers.length; index += 1) {
    const teamIndex = pickOrder[index];
    teams[teamIndex].push(orderedPlayers[index]);
  }

  return teams;
}

function optimizeAssignment(initialTeams, context, iterations = 2200) {
  let currentTeams = cloneTeams(initialTeams);
  let currentScore = calculateAssignmentCost(currentTeams, context).value;
  let bestTeams = cloneTeams(initialTeams);
  let bestScore = currentScore;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const teamA = Math.floor(Math.random() * currentTeams.length);
    let teamB = Math.floor(Math.random() * currentTeams.length);
    if (teamA === teamB) {
      teamB = (teamB + 1) % currentTeams.length;
    }

    if (currentTeams[teamA].length === 0 || currentTeams[teamB].length === 0) {
      continue;
    }

    const playerAIndex = Math.floor(Math.random() * currentTeams[teamA].length);
    const playerBIndex = Math.floor(Math.random() * currentTeams[teamB].length);

    [currentTeams[teamA][playerAIndex], currentTeams[teamB][playerBIndex]] = [
      currentTeams[teamB][playerBIndex],
      currentTeams[teamA][playerAIndex]
    ];

    const nextScore = calculateAssignmentCost(currentTeams, context).value;
    const cooling = 0.28 * (1 - iteration / iterations) + 0.02;
    const acceptance = Math.exp((currentScore - nextScore) / cooling);

    if (nextScore < currentScore || Math.random() < acceptance) {
      currentScore = nextScore;
      if (nextScore < bestScore) {
        bestScore = nextScore;
        bestTeams = cloneTeams(currentTeams);
      }
    } else {
      [currentTeams[teamA][playerAIndex], currentTeams[teamB][playerBIndex]] = [
        currentTeams[teamB][playerBIndex],
        currentTeams[teamA][playerAIndex]
      ];
    }
  }

  return {
    teams: bestTeams,
    score: bestScore
  };
}

function buildTeamSummary(teamPlayers, index) {
  const totalRating = teamPlayers.reduce((sum, player) => sum + player.rating, 0);
  const averageRating = teamPlayers.length > 0 ? totalRating / teamPlayers.length : 0;
  const positionCounts = countPositions(teamPlayers);
  const staminaCounts = countStamina(teamPlayers);

  return {
    name: `Time ${index + 1}`,
    players: teamPlayers
      .map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        stamina: normalizeStamina(player.stamina),
        isGuest: Boolean(player.isGuest),
        rating: Number(player.rating.toFixed(2))
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    totalRating: Number(totalRating.toFixed(2)),
    averageRating: Number(averageRating.toFixed(2)),
    positionCounts: {
      ZAGUEIRO: positionCounts.ZAGUEIRO,
      MEIA: positionCounts.MEIA,
      ATACANTE: positionCounts.ATACANTE,
      FLEX: positionCounts.FLEX
    },
    staminaCounts: {
      BAIXA: staminaCounts.BAIXA,
      MEDIA: staminaCounts.MEDIA,
      ALTA: staminaCounts.ALTA
    }
  };
}

export function drawBalancedTeams(players, teamCount, { maxPlayersPerTeam = 5 } = {}) {
  if (!Array.isArray(players) || players.length === 0) {
    throw new Error('Selecione jogadores para realizar o sorteio.');
  }

  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 4) {
    throw new Error('O sorteio deve ter entre 2 e 4 times.');
  }

  if (players.length < teamCount) {
    throw new Error('Selecione ao menos um jogador por time para sortear.');
  }

  if (players.length > teamCount * maxPlayersPerTeam) {
    throw new Error(
      `Com ${teamCount} times, selecione no máximo ${teamCount * maxPlayersPerTeam} jogadores para o sorteio.`
    );
  }

  const normalizedPlayers = shuffle(players).map((player) => ({
    id: String(player.id),
    name: String(player.name || 'Jogador'),
    rating: normalizedRating(player),
    position: normalizePosition(player.position),
    stamina: normalizeStamina(player.stamina)
  }));

  const capacities = buildTeamCapacities(normalizedPlayers.length, teamCount);
  const totalDefenders = normalizedPlayers.filter((player) => player.position === 'ZAGUEIRO').length;
  const assignmentContext = {
    minimumDefenders: minimumDefendersPerTeam(totalDefenders, teamCount)
  };
  let best = null;

  for (let restart = 0; restart < 28; restart += 1) {
    const initialTeams = createInitialAssignment(shuffle(normalizedPlayers), capacities);
    const optimized = optimizeAssignment(initialTeams, assignmentContext, 1800);

    if (!best || optimized.score < best.score) {
      best = optimized;
    }
  }

  const teams = (best?.teams || []).map((teamPlayers, index) => buildTeamSummary(teamPlayers, index));
  const averages = teams.map((team) => team.averageRating);
  const maxAverage = Math.max(...averages);
  const minAverage = Math.min(...averages);
  const spread = Number((maxAverage - minAverage).toFixed(2));
  const highStaminaCounts = teams.map((team) => Number(team.staminaCounts.ALTA || 0));
  const lowStaminaCounts = teams.map((team) => Number(team.staminaCounts.BAIXA || 0));
  const highSpread = Math.max(...highStaminaCounts) - Math.min(...highStaminaCounts);
  const lowSpread = Math.max(...lowStaminaCounts) - Math.min(...lowStaminaCounts);

  return {
    teams,
    balance: {
      minAverageRating: Number(minAverage.toFixed(2)),
      maxAverageRating: Number(maxAverage.toFixed(2)),
      spread,
      staminaSpread: {
        high: highSpread,
        low: lowSpread
      }
    }
  };
}
