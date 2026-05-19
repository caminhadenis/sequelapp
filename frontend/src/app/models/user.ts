export type UserRole = 'ADM' | 'JOGADOR';
export type ApprovalStatus = 'PENDING' | 'APPROVED';
export type PlayerPosition = 'ZAGUEIRO' | 'MEIA' | 'ATACANTE';
export type PlayerStamina = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface User {
  id: string;
  name: string;
  profileImageUrl?: string | null;
  username: string;
  role: UserRole;
  position?: PlayerPosition;
  stamina?: PlayerStamina;
  approvalStatus?: ApprovalStatus;
  createdAt?: string;
  initialRating?: number | null;
  ratingAverage?: number | null;
  totalGoals: number;
  totalAssists: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  totalRachas?: number;
  totalCraquePoints: number;
  totalCraqueFirstPlaces: number;
  totalCraqueSecondPlaces: number;
  totalCraqueThirdPlaces: number;
  totalTournamentTitles: number;
}

export interface PendingApprovalUser {
  id: string;
  name: string;
  username: string;
  role: 'JOGADOR';
  approvalStatus: 'PENDING';
  createdAt: string;
}

export interface PositionRankingEntry {
  id: string;
  rank: number;
  name: string;
  username: string;
  position: PlayerPosition;
  profileImageUrl?: string | null;
  games: number;
}

export interface PositionRankingResponse {
  totalHappenedRachas?: number;
  minimumGames?: number;
  zagueiro: PositionRankingEntry[];
  meia: PositionRankingEntry[];
  atacante: PositionRankingEntry[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface SignupResponse {
  message: string;
}
