import assert from 'node:assert/strict';
import test from 'node:test';
import { getParticipantIdSet, getTeammateIdSet } from '../src/utils/pelada.js';

test('lista apenas companheiros do mesmo time', () => {
  const pelada = {
    teams: [
      { players: ['player-1', 'player-2', 'player-3'] },
      { players: ['player-4', 'player-5'] }
    ]
  };

  assert.deepEqual(Array.from(getTeammateIdSet(pelada, 'player-1')).sort(), ['player-2', 'player-3']);
});

test('nao lista jogadores de outros times como companheiros', () => {
  const pelada = {
    teams: [
      { players: ['player-1', 'player-2'] },
      { players: ['player-3', 'player-4'] }
    ]
  };

  const teammates = getTeammateIdSet(pelada, 'player-1');

  assert.equal(teammates.has('player-2'), true);
  assert.equal(teammates.has('player-3'), false);
  assert.equal(teammates.has('player-4'), false);
});

test('funciona com jogadores populados pelo mongoose', () => {
  const pelada = {
    teams: [
      {
        players: [
          { _id: 'player-1', name: 'Jogador 1' },
          { _id: 'player-2', name: 'Jogador 2' }
        ]
      }
    ]
  };

  assert.deepEqual(Array.from(getParticipantIdSet(pelada)).sort(), ['player-1', 'player-2']);
  assert.deepEqual(Array.from(getTeammateIdSet(pelada, { _id: 'player-1' })), ['player-2']);
});

test('retorna vazio quando o jogador nao esta em nenhum time', () => {
  const pelada = {
    teams: [{ players: ['player-1', 'player-2'] }]
  };

  assert.deepEqual(Array.from(getTeammateIdSet(pelada, 'player-3')), []);
});
