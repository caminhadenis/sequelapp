import assert from 'node:assert/strict';
import test from 'node:test';
import { drawBalancedTeamOptions } from '../src/utils/team-draw.js';

test('gera tres opcoes de sorteio quando existem combinacoes suficientes', () => {
  const players = Array.from({ length: 12 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Jogador ${index + 1}`,
    rating: 2.5 + (index % 5) * 0.4,
    position: ['ZAGUEIRO', 'MEIA', 'ATACANTE'][index % 3],
    stamina: ['BAIXA', 'MEDIA', 'ALTA'][index % 3]
  }));

  const options = drawBalancedTeamOptions(players, 3, {
    maxPlayersPerTeam: 5,
    optionsCount: 3
  });

  assert.equal(options.length, 3);
  assert.deepEqual(
    options.map((option) => option.label),
    ['Opção 1', 'Opção 2', 'Opção 3']
  );

  for (const option of options) {
    assert.equal(option.teams.length, 3);
    assert.equal(option.teams.reduce((sum, team) => sum + team.players.length, 0), 12);
    assert.equal(typeof option.balance.spread, 'number');
  }
});
