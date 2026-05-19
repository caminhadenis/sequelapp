import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { PlayerPosition, PositionRankingEntry, PositionRankingResponse, User } from '../../models/user';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';
import { toAbsoluteProfileImageUrl } from '../../shared/utils/profile-image';

type PodiumMetric = 'goals' | 'assists' | 'titles' | 'wins' | 'craqueTop3';
type PodiumTieBreak = 'LESS_GAMES' | 'MORE_GAMES' | 'RATING' | 'CRAQUE_OLYMPIC';

interface PodiumEntry {
  rank: 1 | 2 | 3;
  userId: string;
  userName: string;
  username: string;
  profileImageUrl: string | null;
  value: number;
  secondaryLabel?: string;
}

interface PodiumSlot {
  rank: 1 | 2 | 3;
  entries: PodiumEntry[];
}

interface PodiumCategory {
  metric: PodiumMetric;
  title: string;
  subtitle: string;
  icon: string;
  unit: string;
  topThree: PodiumEntry[];
  slots: PodiumSlot[];
}

interface PositionPodiumRankGroup {
  rank: 1 | 2 | 3;
  players: PositionRankingEntry[];
}

interface PositionPodiumCard {
  key: PlayerPosition;
  title: string;
  subtitle: string;
  rankGroups: PositionPodiumRankGroup[];
}

@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTableModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatProgressBarModule,
    RouterLink,
    PlayerNamePipe
  ],
  templateUrl: './ranking.component.html',
  styleUrls: ['./ranking.component.scss']
})
export class RankingComponent implements OnInit {
  loading = false;
  users: User[] = [];
  searchTerm = '';
  podiumCategories: PodiumCategory[] = [];
  positionPodiumCards: PositionPodiumCard[] = [];
  private readonly baseDisplayedColumns = [
    'name',
    'totalGoals',
    'totalAssists',
    'totalTournamentTitles',
    'totalWins',
    'totalDraws',
    'totalLosses'
  ];

  readonly ratingForm = this.formBuilder.group({
    userId: ['', Validators.required],
    initialRating: [3, [Validators.required, Validators.min(1), Validators.max(5)]]
  });

  constructor(
    public readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly formBuilder: FormBuilder,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  get displayedColumns(): string[] {
    if (this.authService.isAdmin) {
      return [...this.baseDisplayedColumns, 'ratingAverage', 'actions'];
    }
    return this.baseDisplayedColumns;
  }

  loadUsers(): void {
    this.loading = true;
    forkJoin({
      users: this.userService.getUsers(),
      byPosition: this.userService.getPositionRanking()
    }).subscribe({
      next: ({ users, byPosition }) => {
        this.users = users;
        this.podiumCategories = this.buildPodiumCategories();
        this.positionPodiumCards = this.buildPositionPodiumCards(byPosition);
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao carregar ranking.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  updateInitialRating(): void {
    if (!this.authService.isAdmin || this.ratingForm.invalid || this.loading) {
      this.ratingForm.markAllAsTouched();
      return;
    }

    const { userId, initialRating } = this.ratingForm.getRawValue();
    if (!userId || initialRating === null || initialRating === undefined) {
      return;
    }

    this.loading = true;
    this.userService.updateInitialRating(userId, Number(initialRating)).subscribe({
      next: () => {
        this.snackBar.open('Nota inicial atualizada.', 'Fechar', { duration: 2500 });
        this.loadUsers();
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar nota inicial.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.searchTerm = target?.value || '';
  }

  clearSearch(): void {
    this.searchTerm = '';
  }

  get filteredUsers(): User[] {
    const query = this.normalize(this.searchTerm);
    if (!query) {
      return this.users;
    }

    return this.users.filter((user) => {
      const name = this.normalize(user.name);
      const username = this.normalize(user.username);
      return name.includes(query) || username.includes(query);
    });
  }

  averageRating(): number {
    if (this.users.length === 0) {
      return 0;
    }

    const total = this.users.reduce((sum, user) => sum + Number(user.ratingAverage || 0), 0);
    return Number((total / this.users.length).toFixed(2));
  }

  hasPlayersInPositionCard(card: PositionPodiumCard): boolean {
    return card.rankGroups.some((group) => group.players.length > 0);
  }

  private buildPodiumCategories(): PodiumCategory[] {
    const goals = this.buildPodiumCategory({
      metric: 'goals',
      title: 'Artilheiros',
      subtitle: 'Top 3 em gols no histórico (desempate: menos rachas)',
      icon: 'sports_soccer',
      unit: 'gols',
      metricValue: (user) => Number(user.totalGoals || 0),
      tieBreak: 'LESS_GAMES'
    });

    const assists = this.buildPodiumCategory({
      metric: 'assists',
      title: 'Garçons',
      subtitle: 'Top 3 em assistências (desempate: menos rachas)',
      icon: 'assistant',
      unit: 'assistências',
      metricValue: (user) => Number(user.totalAssists || 0),
      tieBreak: 'LESS_GAMES'
    });

    const titles = this.buildPodiumCategory({
      metric: 'titles',
      title: 'Campeões',
      subtitle: 'Top 3 em títulos de torneio',
      icon: 'emoji_events',
      unit: 'títulos',
      metricValue: (user) => Number(user.totalTournamentTitles || 0),
      tieBreak: 'RATING'
    });

    const wins = this.buildPodiumCategory({
      metric: 'wins',
      title: 'Mais Vitórias',
      subtitle: 'Top 3 em vitórias (desempate: menos rachas)',
      icon: 'military_tech',
      unit: 'vitórias',
      metricValue: (user) => Number(user.totalWins || 0),
      tieBreak: 'LESS_GAMES'
    });

    const craqueTop3 = this.buildPodiumCategory({
      metric: 'craqueTop3',
      title: 'Presença no Top 3 Craque',
      subtitle: 'Top 3 de participações no pódio de craque (desempate olímpico: 1º, 2º, 3º)',
      icon: 'workspace_premium',
      unit: 'participações',
      metricValue: (user) => this.totalCraqueTop3Participations(user),
      tieBreak: 'CRAQUE_OLYMPIC',
      secondaryLabel: (user) =>
        `1º: ${Number(user.totalCraqueFirstPlaces || 0)} • 2º: ${Number(user.totalCraqueSecondPlaces || 0)} • 3º: ${Number(user.totalCraqueThirdPlaces || 0)}`
    });

    return [goals, assists, titles, wins, craqueTop3];
  }

  private buildPodiumCategory(config: {
    metric: PodiumMetric;
    title: string;
    subtitle: string;
    icon: string;
    unit: string;
    metricValue: (user: User) => number;
    tieBreak: PodiumTieBreak;
    secondaryLabel?: (user: User) => string;
  }): PodiumCategory {
    const topThree = this.getTopThreeEntries(config.metricValue, config.tieBreak, config.secondaryLabel);
    return {
      metric: config.metric,
      title: config.title,
      subtitle: config.subtitle,
      icon: config.icon,
      unit: config.unit,
      topThree,
      slots: this.buildPodiumSlots(topThree)
    };
  }

  private getTopThreeEntries(
    metricValue: (user: User) => number,
    tieBreak: PodiumTieBreak,
    secondaryLabel?: (user: User) => string
  ): PodiumEntry[] {
    const sorted = [...this.users]
      .map((user) => ({
        user,
        metric: metricValue(user),
        tieBreakKey: this.resolveTieBreakKey(user, tieBreak)
      }))
      .filter((item) => item.metric > 0)
      .sort((a, b) => {
        const metricDiff = b.metric - a.metric;
        if (metricDiff !== 0) {
          return metricDiff;
        }

        const tieBreakDiff = this.compareUsersByTieBreak(a.user, b.user, tieBreak);
        if (tieBreakDiff !== 0) {
          return tieBreakDiff;
        }

        return a.user.name.localeCompare(b.user.name, 'pt-BR');
      });

    const ranking: PodiumEntry[] = [];
    let previous: { metric: number; tieBreakKey: string; rank: 1 | 2 | 3 } | null = null;

    for (let index = 0; index < sorted.length; index += 1) {
      const item = sorted[index];
      let rank: number = 1;

      if (previous) {
        const isTie = item.metric === previous.metric && item.tieBreakKey === previous.tieBreakKey;
        rank = isTie ? previous.rank : previous.rank + 1;
      }

      if (rank > 3) {
        break;
      }

      const normalizedRank = rank as 1 | 2 | 3;
      ranking.push({
        rank: normalizedRank,
        userId: item.user.id,
        userName: item.user.name,
        username: item.user.username,
        profileImageUrl: toAbsoluteProfileImageUrl(item.user.profileImageUrl),
        value: item.metric,
        secondaryLabel: secondaryLabel ? secondaryLabel(item.user) : undefined
      });

      previous = {
        metric: item.metric,
        tieBreakKey: item.tieBreakKey,
        rank: normalizedRank
      };
    }

    return ranking;
  }

  private buildPodiumSlots(entries: PodiumEntry[]): PodiumSlot[] {
    const rankOrder: Array<1 | 2 | 3> = [2, 1, 3];
    return rankOrder.map((rank) => ({
      rank,
      entries: this.findByRank(entries, rank)
    }));
  }

  private buildPositionPodiumCards(byPosition: PositionRankingResponse): PositionPodiumCard[] {
    const subtitle = this.positionPodiumSubtitle(byPosition);

    return [
      {
        key: 'ZAGUEIRO',
        title: 'Melhores Zagueiros',
        subtitle,
        rankGroups: this.buildPositionRankGroups(this.normalizePositionEntries(byPosition.zagueiro || []))
      },
      {
        key: 'MEIA',
        title: 'Melhores Meias',
        subtitle,
        rankGroups: this.buildPositionRankGroups(this.normalizePositionEntries(byPosition.meia || []))
      },
      {
        key: 'ATACANTE',
        title: 'Melhores Atacantes',
        subtitle,
        rankGroups: this.buildPositionRankGroups(this.normalizePositionEntries(byPosition.atacante || []))
      }
    ];
  }

  private positionPodiumSubtitle(byPosition: PositionRankingResponse): string {
    const totalHappenedRachas = Number(byPosition?.totalHappenedRachas || 0);
    const minimumGames = Number(byPosition?.minimumGames || 0);

    if (totalHappenedRachas <= 0 || minimumGames <= 0) {
      return 'Top 3 por nota média (desempate: mais rachas)';
    }

    const rachaLabel = minimumGames === 1 ? 'racha' : 'rachas';
    return `Top 3 por nota média (mínimo ${minimumGames} ${rachaLabel} = 25% de ${totalHappenedRachas})`;
  }

  private buildPositionRankGroups(entries: PositionRankingEntry[]): PositionPodiumRankGroup[] {
    const rankOrder: Array<1 | 2 | 3> = [1, 2, 3];
    return rankOrder.map((rank) => ({
      rank,
      players: entries.filter((entry) => entry.rank === rank)
    }));
  }

  private normalizePositionEntries(entries: PositionRankingEntry[]): PositionRankingEntry[] {
    return entries.map((entry) => ({
      ...entry,
      rank: this.toRank(entry.rank),
      profileImageUrl: toAbsoluteProfileImageUrl(entry.profileImageUrl)
    }));
  }

  private compareUsersByTieBreak(leftUser: User, rightUser: User, tieBreak: PodiumTieBreak): number {
    if (tieBreak === 'LESS_GAMES') {
      return this.totalGames(leftUser) - this.totalGames(rightUser);
    }

    if (tieBreak === 'MORE_GAMES') {
      return this.totalGames(rightUser) - this.totalGames(leftUser);
    }

    if (tieBreak === 'RATING') {
      return Number(rightUser.ratingAverage || 0) - Number(leftUser.ratingAverage || 0);
    }

    const leftFirst = Number(leftUser.totalCraqueFirstPlaces || 0);
    const rightFirst = Number(rightUser.totalCraqueFirstPlaces || 0);
    if (rightFirst !== leftFirst) {
      return rightFirst - leftFirst;
    }

    const leftSecond = Number(leftUser.totalCraqueSecondPlaces || 0);
    const rightSecond = Number(rightUser.totalCraqueSecondPlaces || 0);
    if (rightSecond !== leftSecond) {
      return rightSecond - leftSecond;
    }

    const leftThird = Number(leftUser.totalCraqueThirdPlaces || 0);
    const rightThird = Number(rightUser.totalCraqueThirdPlaces || 0);
    if (rightThird !== leftThird) {
      return rightThird - leftThird;
    }

    return 0;
  }

  private resolveTieBreakKey(user: User, tieBreak: PodiumTieBreak): string {
    if (tieBreak === 'LESS_GAMES' || tieBreak === 'MORE_GAMES') {
      return String(this.totalGames(user));
    }

    if (tieBreak === 'RATING') {
      return String(Number(user.ratingAverage || 0));
    }

    const first = Number(user.totalCraqueFirstPlaces || 0);
    const second = Number(user.totalCraqueSecondPlaces || 0);
    const third = Number(user.totalCraqueThirdPlaces || 0);
    return `${first}|${second}|${third}`;
  }

  private totalCraqueTop3Participations(user: User): number {
    return (
      Number(user.totalCraqueFirstPlaces || 0) +
      Number(user.totalCraqueSecondPlaces || 0) +
      Number(user.totalCraqueThirdPlaces || 0)
    );
  }

  private totalGames(user: User): number {
    return (
      Number(user.totalWins || 0) +
      Number(user.totalDraws || 0) +
      Number(user.totalLosses || 0)
    );
  }

  private findByRank(entries: PodiumEntry[], rank: 1 | 2 | 3): PodiumEntry[] {
    return entries.filter((entry) => entry.rank === rank);
  }

  private toRank(value: number): 1 | 2 | 3 {
    if (value === 1 || value === 2 || value === 3) {
      return value;
    }

    return 3;
  }

  private normalize(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
