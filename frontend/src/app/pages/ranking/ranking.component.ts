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
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { PlayerPosition, PositionRankingEntry, PositionRankingResponse, User } from '../../models/user';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';
import { toAbsoluteProfileImageUrl } from '../../shared/utils/profile-image';

type PodiumMetric = 'goals' | 'assists' | 'titles';
type PodiumTieBreak = 'LESS_GAMES' | 'MORE_GAMES' | 'RATING';

interface PodiumEntry {
  rank: 1 | 2 | 3;
  userId: string;
  userName: string;
  username: string;
  profileImageUrl: string | null;
  value: number;
}

interface PodiumCategory {
  metric: PodiumMetric;
  title: string;
  subtitle: string;
  icon: string;
  unit: string;
  topThree: PodiumEntry[];
  slots: Array<PodiumEntry | null>;
}

interface PositionPodiumCard {
  key: PlayerPosition;
  title: string;
  subtitle: string;
  players: PositionRankingEntry[];
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
      return [...this.baseDisplayedColumns, 'ratingAverage'];
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

  private buildPodiumCategories(): PodiumCategory[] {
    const goals = this.buildPodiumCategory({
      metric: 'goals',
      title: 'Artilheiros',
      subtitle: 'Top 3 em gols no histórico',
      icon: 'sports_soccer',
      unit: 'gols',
      metricValue: (user) => Number(user.totalGoals || 0),
      tieBreak: 'LESS_GAMES'
    });

    const assists = this.buildPodiumCategory({
      metric: 'assists',
      title: 'Garçons',
      subtitle: 'Top 3 em assistências',
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

    return [goals, assists, titles];
  }

  private buildPodiumCategory(config: {
    metric: PodiumMetric;
    title: string;
    subtitle: string;
    icon: string;
    unit: string;
    metricValue: (user: User) => number;
    tieBreak: PodiumTieBreak;
  }): PodiumCategory {
    const topThree = this.getTopThree(config.metricValue, config.tieBreak);
    return {
      metric: config.metric,
      title: config.title,
      subtitle: config.subtitle,
      icon: config.icon,
      unit: config.unit,
      topThree,
      slots: [this.findByRank(topThree, 2), this.findByRank(topThree, 1), this.findByRank(topThree, 3)]
    };
  }

  private getTopThree(metricValue: (user: User) => number, tieBreak: PodiumTieBreak): PodiumEntry[] {
    const sorted = [...this.users]
      .filter((user) => metricValue(user) > 0)
      .sort((a, b) => {
        const metricDiff = metricValue(b) - metricValue(a);
        if (metricDiff !== 0) return metricDiff;

        if (tieBreak === 'LESS_GAMES') {
          const gamesDiff = this.totalGames(a) - this.totalGames(b);
          if (gamesDiff !== 0) return gamesDiff;
        } else if (tieBreak === 'MORE_GAMES') {
          const gamesDiff = this.totalGames(b) - this.totalGames(a);
          if (gamesDiff !== 0) return gamesDiff;
        } else {
          const ratingDiff = Number(b.ratingAverage || 0) - Number(a.ratingAverage || 0);
          if (ratingDiff !== 0) return ratingDiff;
        }

        return a.name.localeCompare(b.name, 'pt-BR');
      })
      .slice(0, 3);

    return sorted.map((user, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      userId: user.id,
      userName: user.name,
      username: user.username,
      profileImageUrl: toAbsoluteProfileImageUrl(user.profileImageUrl),
      value: metricValue(user)
    }));
  }

  private buildPositionPodiumCards(byPosition: PositionRankingResponse): PositionPodiumCard[] {
    return [
      {
        key: 'ZAGUEIRO',
        title: 'Melhores Zagueiros',
        subtitle: 'Top 3 por nota média (desempate: mais jogos)',
        players: this.normalizePositionEntries(byPosition.zagueiro || [])
      },
      {
        key: 'MEIA',
        title: 'Melhores Meias',
        subtitle: 'Top 3 por nota média (desempate: mais jogos)',
        players: this.normalizePositionEntries(byPosition.meia || [])
      },
      {
        key: 'ATACANTE',
        title: 'Melhores Atacantes',
        subtitle: 'Top 3 por nota média (desempate: mais jogos)',
        players: this.normalizePositionEntries(byPosition.atacante || [])
      }
    ];
  }

  private normalizePositionEntries(entries: PositionRankingEntry[]): PositionRankingEntry[] {
    return entries.map((entry) => ({
      ...entry,
      profileImageUrl: toAbsoluteProfileImageUrl(entry.profileImageUrl)
    }));
  }

  private totalGames(user: User): number {
    return (
      Number(user.totalWins || 0) +
      Number(user.totalDraws || 0) +
      Number(user.totalLosses || 0)
    );
  }

  private findByRank(entries: PodiumEntry[], rank: 1 | 2 | 3): PodiumEntry | null {
    return entries.find((entry) => entry.rank === rank) || null;
  }

  private normalize(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
}
