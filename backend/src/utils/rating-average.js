function validRating(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0.5 && numericValue <= 5
    ? numericValue
    : null;
}

function ratingScore(value) {
  return validRating(typeof value === 'number' ? value : value?.score);
}

export function trimExtremeRatings(values = []) {
  const normalized = (Array.isArray(values) ? values : [])
    .map((value, index) => ({
      value,
      index,
      score: ratingScore(value)
    }))
    .filter((item) => item.score !== null);

  if (normalized.length < 3) {
    return normalized.map((item) => item.value);
  }

  const sorted = [...normalized].sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    return left.index - right.index;
  });
  const discardedIndexes = new Set([
    sorted[0].index,
    sorted[sorted.length - 1].index
  ]);

  return normalized
    .filter((item) => !discardedIndexes.has(item.index))
    .map((item) => item.value);
}

export function summarizeRachaRatings(values = []) {
  const includedRatings = trimExtremeRatings(values);
  const scores = includedRatings.map((value) => ratingScore(value));
  const sum = scores.reduce((total, score) => total + score, 0);

  return {
    includedRatings,
    sum,
    count: scores.length,
    average: scores.length > 0 ? Number((sum / scores.length).toFixed(2)) : null
  };
}

function nonNegativeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0;
}

function nonNegativeInteger(value) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue >= 0 ? numericValue : 0;
}

export function calculateRatingAverage({
  initialRating,
  allVotesSum,
  allVotesCount,
  manualRatingAverage,
  manualRatingBaseCount,
  futureVotesSum,
  futureVotesCount
}) {
  const normalizedInitialRating = validRating(initialRating) ?? 3;
  const normalizedManualRating = validRating(manualRatingAverage);
  const normalizedAllVotesCount = nonNegativeInteger(allVotesCount);
  const normalizedAllVotesSum = nonNegativeNumber(allVotesSum);
  const normalizedFutureVotesCount = nonNegativeInteger(futureVotesCount);
  const normalizedFutureVotesSum = nonNegativeNumber(futureVotesSum);

  if (normalizedManualRating !== null) {
    const explicitBaseCount = Number(manualRatingBaseCount);
    const inferredHistoricalCount = Math.max(
      normalizedAllVotesCount - normalizedFutureVotesCount,
      1
    );
    const baseCount =
      Number.isInteger(explicitBaseCount) && explicitBaseCount >= 1
        ? explicitBaseCount
        : inferredHistoricalCount;
    const combinedCount = baseCount + normalizedFutureVotesCount;
    const combinedSum = normalizedManualRating * baseCount + normalizedFutureVotesSum;

    return {
      ratingAverage: Number((combinedSum / combinedCount).toFixed(2)),
      manualRatingBaseCount: baseCount
    };
  }

  return {
    ratingAverage:
      normalizedAllVotesCount > 0
        ? Number((normalizedAllVotesSum / normalizedAllVotesCount).toFixed(2))
        : normalizedInitialRating,
    manualRatingBaseCount: null
  };
}
