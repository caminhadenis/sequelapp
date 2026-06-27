export function canSeeRatingsForRole(role) {
  return role === 'ADM';
}

export function canRequesterSeeRatings(requestUser) {
  return canSeeRatingsForRole(requestUser?.role);
}

export function sanitizeUserPayloadForRole(userPayload, role, options = {}) {
  const includeOwnRatings = Boolean(options?.includeOwnRatings);

  if (!userPayload || canSeeRatingsForRole(role)) {
    return userPayload;
  }

  const next = { ...userPayload };
  delete next.initialRating;
  delete next.manualRatingAverage;
  delete next.manualRatingBaseCount;
  delete next.manualRatingSetAt;
  delete next.stamina;

  if (!includeOwnRatings) {
    delete next.ratingAverage;
  }

  return next;
}
