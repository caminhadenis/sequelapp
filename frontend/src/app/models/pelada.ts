export type VotingStatus = 'CLOSED' | 'OPEN' | 'FINISHED';
export type RachaStatus = 'OPEN' | 'CONCLUDED';
export type RachaType = 'NORMAL' | 'TOURNAMENT';
export type PlayerPosition = 'ZAGUEIRO' | 'MEIA' | 'ATACANTE';
export type PlayerStamina = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface PeladaSummary {
  id: string;
  date: string;
  type: RachaType;
  happened: boolean;
  status: RachaStatus;
  votingStatus: VotingStatus;
  teamsCount: number;
}

export interface PeladaPlayer {
  id: string;
  name: string;
  username: string;
  role: 'ADM' | 'JOGADOR';
  profileImageUrl?: string | null;
  position?: PlayerPosition;
  stamina?: PlayerStamina;
  ratingAverage?: number | null;
}

export interface PeladaGuestPlayer {
  name: string;
  position: PlayerPosition;
}

export interface PeladaTeam {
  id: string;
  name: string;
  goalkeepers: string[];
  guestPlayers: PeladaGuestPlayer[];
  wins: number;
  draws: number;
  losses: number;
  players: PeladaPlayer[];
}

export interface PeladaPlayerStat {
  playerId: string;
  playerName?: string;
  goals: number;
  assists: number;
}

export interface DrawDraftGuestPlayer {
  name: string;
  rating: number;
  position: PlayerPosition | null;
  stamina: PlayerStamina;
}

export interface DrawDraft {
  teamCount: number;
  playerIds: string[];
  guestPlayers: DrawDraftGuestPlayer[];
  updatedAt: string | null;
}

export interface PresenceEntry {
  order: number;
  userId: string;
  userName: string;
  username: string;
  profileImageUrl?: string | null;
  markedAt: string | null;
  isWaitingList: boolean;
}

export interface PresenceInfo {
  limit: number;
  openAt: string | null;
  isEligibleRacha: boolean;
  canMarkNow: boolean;
  totalMarked: number;
  confirmedCount: number;
  waitingCount: number;
  myEntry: PresenceEntry | null;
  entries: PresenceEntry[];
}

export interface CraquePodiumItem {
  position: number;
  playerId: string;
  playerName: string;
  points: number;
  firstPlaces: number;
  secondPlaces: number;
  thirdPlaces: number;
}

export interface CraquePodium {
  totalBallots: number;
  top3: CraquePodiumItem[];
}

export interface SelectionOfRoundPlayer {
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string | null;
  position: PlayerPosition;
}

export interface SelectionOfRound {
  isAvailable: boolean;
  totalEligible: number;
  players: SelectionOfRoundPlayer[];
}

export interface TournamentMatch {
  id: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  isFinished: boolean;
}

export interface TournamentStanding {
  position: number;
  teamId: string;
  teamName: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  directPoints: number;
}

export interface TournamentInfo {
  standings: TournamentStanding[];
  matches: TournamentMatch[];
  isCompleted: boolean;
  championTeamId: string | null;
  championTeamName: string | null;
  totalMatches: number;
}

export interface PeladaDetail {
  id: string;
  date: string;
  type: RachaType;
  happened: boolean;
  status: RachaStatus;
  votingStatus: VotingStatus;
  teams: PeladaTeam[];
  playerStats: PeladaPlayerStat[];
  drawDraft: DrawDraft | null;
  presence: PresenceInfo;
  votesCount: number;
  tournament: TournamentInfo | null;
  craquePodium: CraquePodium;
  selectionOfRound: SelectionOfRound | null;
}

export interface CraqueVoteSelection {
  firstUserId: string;
  secondUserId: string;
  thirdUserId: string;
}

export interface RatingCard {
  playerId: string;
  name: string;
  username: string;
  profileImageUrl?: string | null;
  ratingAverage?: number | null;
  matchGoals: number;
  matchAssists: number;
  matchWins: number;
  matchDraws: number;
  matchLosses: number;
  alreadyRatedByMe: boolean;
  canVote: boolean;
}

export interface RatingCardsResponse {
  peladaId: string;
  status: RachaStatus;
  votingStatus: VotingStatus;
  canCurrentUserVote: boolean;
  canCurrentUserVoteCraque: boolean;
  myMatchRating: number | null;
  myCraqueVote: CraqueVoteSelection | null;
  cards: RatingCard[];
}

export interface VoteDetail {
  voteId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface VoteDetailsResponse {
  peladaId: string;
  status: RachaStatus;
  votingStatus: VotingStatus;
  votes: VoteDetail[];
}

export interface DrawTeamPlayer {
  id: string;
  name: string;
  position: PlayerPosition | null;
  stamina?: PlayerStamina;
  isGuest?: boolean;
  rating?: number;
}

export interface DrawTeamResult {
  name: string;
  players: DrawTeamPlayer[];
  totalRating: number;
  averageRating: number;
  positionCounts: {
    ZAGUEIRO: number;
    MEIA: number;
    ATACANTE: number;
    FLEX: number;
  };
  staminaCounts: {
    BAIXA: number;
    MEDIA: number;
    ALTA: number;
  };
}

export interface TeamsDrawResponse {
  message: string;
  teamCount: number;
  selectedPlayers: number;
  teams: DrawTeamResult[];
  balance: {
    minAverageRating: number;
    maxAverageRating: number;
    spread: number;
    staminaSpread?: {
      high: number;
      low: number;
    };
  };
}
