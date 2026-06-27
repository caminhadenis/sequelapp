import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRatingAverage,
  summarizeRachaRatings,
  trimExtremeRatings
} from '../src/utils/rating-average.js';

test('remove uma menor e uma maior nota do racha', () => {
  const result = summarizeRachaRatings([1, 2, 3, 4, 5]);

  assert.deepEqual(result.includedRatings, [2, 3, 4]);
  assert.equal(result.average, 3);
  assert.equal(result.count, 3);
});

test('remove apenas uma ocorrencia de cada extremo quando ha notas repetidas', () => {
  assert.deepEqual(trimExtremeRatings([1, 1, 5, 5]), [1, 5]);
});

test('mantem todas as notas quando existem menos de tres votos', () => {
  const result = summarizeRachaRatings([2.5, 4]);

  assert.deepEqual(result.includedRatings, [2.5, 4]);
  assert.equal(result.average, 3.25);
});

test('calcula a media de todos os votos sem ajuste manual', () => {
  const result = calculateRatingAverage({
    initialRating: 3,
    allVotesSum: 14,
    allVotesCount: 4
  });

  assert.equal(result.ratingAverage, 3.5);
  assert.equal(result.manualRatingBaseCount, null);
});

test('usa o ajuste manual como base e incorpora somente votos futuros', () => {
  const result = calculateRatingAverage({
    initialRating: 3,
    allVotesSum: 42,
    allVotesCount: 12,
    manualRatingAverage: 4,
    manualRatingBaseCount: 10,
    futureVotesSum: 7,
    futureVotesCount: 2
  });

  assert.equal(result.ratingAverage, 3.92);
  assert.equal(result.manualRatingBaseCount, 10);
});

test('infere a quantidade historica para ajustes manuais antigos', () => {
  const result = calculateRatingAverage({
    initialRating: 3,
    allVotesSum: 42,
    allVotesCount: 12,
    manualRatingAverage: 4,
    futureVotesSum: 7,
    futureVotesCount: 2
  });

  assert.equal(result.ratingAverage, 3.92);
  assert.equal(result.manualRatingBaseCount, 10);
});

test('trata ajuste sem votos historicos como uma avaliacao base', () => {
  const result = calculateRatingAverage({
    initialRating: 3,
    allVotesSum: 2,
    allVotesCount: 1,
    manualRatingAverage: 4,
    manualRatingBaseCount: 1,
    futureVotesSum: 2,
    futureVotesCount: 1
  });

  assert.equal(result.ratingAverage, 3);
  assert.equal(result.manualRatingBaseCount, 1);
});
