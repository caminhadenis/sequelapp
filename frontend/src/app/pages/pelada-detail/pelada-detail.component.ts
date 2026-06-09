import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import {
  AbstractControl,
  ReactiveFormsModule,
  UntypedFormArray,
  UntypedFormBuilder,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { PeladaService } from '../../core/services/pelada.service';
import { UserService } from '../../core/services/user.service';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';
import { toAbsoluteProfileImageUrl } from '../../shared/utils/profile-image';
import { toPlayerDisplayName } from '../../shared/utils/player-name';
import {
  CraqueVoteSelection,
  PeladaDetail,
  TeamsDrawResponse,
  PeladaGuestPlayer,
  PlayerPosition,
  PlayerStamina,
  PresenceEntry,
  PresenceInfo,
  RatingCard,
  RatingCardsResponse,
  SelectionOfRoundPlayer,
  VoteDetail
} from '../../models/pelada';
import { User } from '../../models/user';

type FieldLine = 'DEFENSE' | 'MIDFIELD' | 'ATTACK';

interface TeamFieldPlayer {
  id: string;
  name: string;
  profileImageUrl?: string | null;
  position?: PlayerPosition;
  isGuest: boolean;
}

interface TeamFieldLayout {
  defense: TeamFieldPlayer[];
  midfield: TeamFieldPlayer[];
  attack: TeamFieldPlayer[];
}

interface DrawGuestPlayer {
  id: string;
  name: string;
  rating: number;
  position: PlayerPosition;
  stamina: PlayerStamina;
}

interface DrawSelectedRegisteredPlayer {
  id: string;
  name: string;
  position: string;
  stamina: string;
  rating: string;
}

interface QuickNavShortcut {
  id: string;
  label: string;
  icon: string;
}

function maxLengthArrayValidator(length: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!Array.isArray(value)) {
      return { invalidArray: true };
    }

    return value.length <= length ? null : { maxLengthArray: { required: length } };
  };
}

@Component({
  selector: 'app-pelada-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatIconModule,
    MatProgressBarModule,
    MatChipsModule,
    PlayerNamePipe
  ],
  templateUrl: './pelada-detail.component.html',
  styleUrls: ['./pelada-detail.component.scss']
})
export class PeladaDetailComponent implements OnInit {
  peladaId = '';
  pelada: PeladaDetail | null = null;
  users: User[] = [];

  loading = false;
  actionLoading = false;
  exportingTeamsImage = false;

  ratingCards: RatingCard[] = [];
  myMatchRating: number | null = null;
  canCurrentUserVote = false;
  canCurrentUserVoteCraque = false;
  voteSelections: Record<string, number> = {};
  readonly quickScoreOptions = Array.from({ length: 10 }, (_, index) => Number(((index + 1) / 2).toFixed(1)));
  ratingFlowQueue: RatingCard[] = [];
  ratingFlowSelectedScore: number | null = null;
  ratingFlowAnimating = false;
  ratingFlowSwipeDirection: 'left' | 'right' | null = null;
  craqueVoteSelections: CraqueVoteSelection = this.emptyCraqueVoteSelections();
  voteGroups: Array<{ toUserId: string; toUserName: string; votes: VoteDetail[] }> = [];
  adminVoteSelections: Record<string, number> = {};
  tournamentRoundGroups: Array<{ round: number; matchIndexes: number[] }> = [];
  mobileQuickNavSelection = '';
  playerStatsSearchTerm = '';
  drawPlayersSearchTerm = '';
  lastDrawResult: TeamsDrawResponse | null = null;
  drawGuestPlayers: DrawGuestPlayer[] = [];
  readonly guestPositionOptions: Array<{ value: PlayerPosition; label: string }> = [
    { value: 'ZAGUEIRO', label: 'Zagueiro' },
    { value: 'MEIA', label: 'Meia' },
    { value: 'ATACANTE', label: 'Atacante' }
  ];
  readonly guestStaminaOptions: Array<{ value: PlayerStamina; label: string }> = [
    { value: 'BAIXA', label: 'Baixa' },
    { value: 'MEDIA', label: 'Média' },
    { value: 'ALTA', label: 'Alta' }
  ];
  readonly resultsValueOptions = Array.from({ length: 11 }, (_, index) => index);
  readonly statsValueOptions = Array.from({ length: 16 }, (_, index) => index);
  readonly maxTeamsPerRacha = 4;
  readonly maxPlayersPerTeam = 5;

  readonly teamForm = this.formBuilder.group({
    teams: this.formBuilder.array([])
  });

  readonly resultsForm = this.formBuilder.group({
    results: this.formBuilder.array([])
  });

  readonly statsForm = this.formBuilder.group({
    stats: this.formBuilder.array([])
  });

  readonly tournamentForm = this.formBuilder.group({
    matches: this.formBuilder.array([])
  });

  readonly presenceConfigForm = this.formBuilder.group({
    openAt: ['', [Validators.required]]
  });

  readonly drawTeamsForm = this.formBuilder.group({
    teamCount: [4, [Validators.required, Validators.min(2), Validators.max(this.maxTeamsPerRacha)]],
    playerIds: [[] as string[]],
    guestNameDraft: [''],
    guestRatingDraft: [3, [Validators.required, Validators.min(1), Validators.max(5)]],
    guestPositionDraft: ['MEIA', [Validators.required]],
    guestStaminaDraft: ['MEDIA', [Validators.required]]
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly formBuilder: UntypedFormBuilder,
    private readonly peladaService: PeladaService,
    private readonly userService: UserService,
    private readonly snackBar: MatSnackBar,
    public readonly authService: AuthService
  ) {}

  get teamsArray(): UntypedFormArray {
    return this.teamForm.get('teams') as UntypedFormArray;
  }

  get resultsArray(): UntypedFormArray {
    return this.resultsForm.get('results') as UntypedFormArray;
  }

  get statsArray(): UntypedFormArray {
    return this.statsForm.get('stats') as UntypedFormArray;
  }

  get tournamentMatchesArray(): UntypedFormArray {
    return this.tournamentForm.get('matches') as UntypedFormArray;
  }

  get drawTeamCount(): number {
    const raw = Number(this.drawTeamsForm.get('teamCount')?.value || 4);
    if (!Number.isInteger(raw)) {
      return 4;
    }
    return Math.min(this.maxTeamsPerRacha, Math.max(2, raw));
  }

  get drawSelectedPlayerIds(): string[] {
    const value = this.drawTeamsForm.get('playerIds')?.value;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((playerId) => String(playerId));
  }

  get maxDrawPlayersCount(): number {
    return this.drawTeamCount * this.maxPlayersPerTeam;
  }

  get selectedDrawPlayersCount(): number {
    return this.drawSelectedPlayerIds.length;
  }

  get drawGuestPlayersCount(): number {
    return this.drawGuestPlayers.length;
  }

  get drawPoolCount(): number {
    return this.selectedDrawPlayersCount + this.drawGuestPlayersCount;
  }

  get canAddDrawGuestPlayer(): boolean {
    return this.drawPoolCount < this.maxDrawPlayersCount;
  }

  get drawAvailableSlots(): number {
    return Math.max(this.maxDrawPlayersCount - this.drawPoolCount, 0);
  }

  get drawMissingPlayersCount(): number {
    return Math.max(this.drawTeamCount - this.drawPoolCount, 0);
  }

  get canSubmitDraw(): boolean {
    return this.drawPoolCount >= this.drawTeamCount && this.drawPoolCount <= this.maxDrawPlayersCount;
  }

  get drawPoolProgressValue(): number {
    if (this.maxDrawPlayersCount <= 0) {
      return 0;
    }
    return Math.round((this.drawPoolCount / this.maxDrawPlayersCount) * 100);
  }

  get drawSelectedRegisteredPlayers(): DrawSelectedRegisteredPlayer[] {
    const usersById = new Map(this.sortedUsersForDraw.map((user) => [String(user.id), user]));
    return this.drawSelectedPlayerIds
      .map((playerId) => {
        const user = usersById.get(String(playerId));
        if (!user) {
          return null;
        }
        const rating =
          typeof user.ratingAverage === 'number' && Number.isFinite(user.ratingAverage)
            ? user.ratingAverage.toFixed(2).replace('.', ',')
            : '--';

        return {
          id: String(user.id),
          name: toPlayerDisplayName(user.name),
          position: this.drawPlayerPositionLabel(user.position),
          stamina: this.drawPlayerStaminaLabel(user.stamina),
          rating
        };
      })
      .filter((item): item is DrawSelectedRegisteredPlayer => Boolean(item))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get sortedUsersForDraw(): User[] {
    return [...this.users].sort((left, right) =>
      toPlayerDisplayName(left.name).localeCompare(toPlayerDisplayName(right.name), 'pt-BR')
    );
  }

  get filteredUsersForDraw(): User[] {
    const normalizedTerm = this.normalizeSearch(this.drawPlayersSearchTerm);
    if (!normalizedTerm) {
      return this.sortedUsersForDraw;
    }

    return this.sortedUsersForDraw.filter((user) => {
      const byName = this.normalizeSearch(toPlayerDisplayName(user.name));
      const byUsername = this.normalizeSearch(String(user.username || ''));
      return byName.includes(normalizedTerm) || byUsername.includes(normalizedTerm);
    });
  }

  get filteredStatsIndexes(): number[] {
    const normalizedTerm = this.normalizeSearch(this.playerStatsSearchTerm);

    return this.statsArray.controls
      .map((_, index) => index)
      .filter((index) => {
        if (!normalizedTerm) {
          return true;
        }

        const playerName = String(this.statsArray.at(index)?.get('playerName')?.value || '');
        return this.normalizeSearch(playerName).includes(normalizedTerm);
      });
  }

  get isTournament(): boolean {
    return (this.pelada?.type || 'NORMAL') === 'TOURNAMENT';
  }

  get useRatingFlowMode(): boolean {
    return !this.authService.isAdmin && this.canCurrentUserVote;
  }

  get currentRatingFlowCard(): RatingCard | null {
    return this.ratingFlowQueue[0] || null;
  }

  get nextRatingFlowCardName(): string | null {
    const nextName = this.ratingFlowQueue[1]?.name;
    return nextName ? toPlayerDisplayName(nextName) : null;
  }

  get ratingFlowPendingCount(): number {
    return this.ratingFlowQueue.length;
  }

  get ratingFlowTotalCount(): number {
    return this.ratingCards.filter(
      (card) => card.playerId !== String(this.authService.currentUser?.id || '')
    ).length;
  }

  get ratingFlowCompletedCount(): number {
    return Math.max(this.ratingFlowTotalCount - this.ratingFlowPendingCount, 0);
  }

  get ratingFlowProgressValue(): number {
    if (this.ratingFlowTotalCount <= 0) {
      return 0;
    }
    return Math.round((this.ratingFlowCompletedCount / this.ratingFlowTotalCount) * 100);
  }

  get ratedPlayersByMe(): RatingCard[] {
    return this.ratingCards
      .filter((card) => card.alreadyRatedByMe)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get presenceInfo(): PresenceInfo | null {
    return this.pelada?.presence || null;
  }

  get presenceEntries(): PresenceEntry[] {
    return this.presenceInfo?.entries || [];
  }

  get confirmedPresenceEntries(): PresenceEntry[] {
    return this.presenceEntries.filter((entry) => !entry.isWaitingList);
  }

  get waitingPresenceEntries(): PresenceEntry[] {
    return this.presenceEntries.filter((entry) => entry.isWaitingList);
  }

  get canConfigurePresence(): boolean {
    return Boolean(this.authService.isAdmin && this.presenceInfo?.isEligibleRacha && !this.isConcluded);
  }

  get canCurrentUserMarkPresence(): boolean {
    return Boolean(
      !this.authService.isAdmin &&
        this.presenceInfo?.canMarkNow &&
        !this.presenceInfo?.myEntry &&
        !this.isConcluded
    );
  }

  get canCurrentUserCancelPresence(): boolean {
    return Boolean(
      !this.authService.isAdmin &&
        this.presenceInfo?.isEligibleRacha &&
        this.presenceInfo?.myEntry &&
        !this.isConcluded
    );
  }

  get isCurrentUserParticipantInRacha(): boolean {
    const currentUserId = String(this.authService.currentUser?.id || '');
    if (!currentUserId) {
      return false;
    }

    return this.ratingCards.some((card) => card.playerId === currentUserId);
  }

  get quickNavShortcuts(): QuickNavShortcut[] {
    const shortcuts: QuickNavShortcut[] = [];

    if (this.authService.isAdmin) {
      shortcuts.push(
        { id: 'presence-section', label: 'Presença', icon: 'how_to_reg' },
        { id: 'admin-management-section', label: 'Gestão de times', icon: 'construction' },
        { id: 'results-section', label: 'Resultados', icon: 'leaderboard' },
        { id: 'stats-section', label: 'Gols e assistências', icon: 'sports_soccer' },
        { id: 'voting-section', label: 'Notas e votação', icon: 'star' },
        { id: 'audit-section', label: 'Auditoria', icon: 'fact_check' }
      );
    } else {
      shortcuts.push(
        { id: 'voting-section', label: 'Ir para votação', icon: 'star' },
        { id: 'presence-section', label: 'Presença', icon: 'how_to_reg' }
      );
    }

    shortcuts.push({ id: 'teams-section', label: 'Times', icon: 'groups' });

    if (this.pelada?.votingStatus === 'FINISHED') {
      shortcuts.push({ id: 'selection-section', label: 'Seleção da rodada', icon: 'military_tech' });
    }

    if (this.isTournament) {
      shortcuts.push({ id: 'tournament-section', label: 'Torneio', icon: 'emoji_events' });
    }

    return shortcuts;
  }

  ngOnInit(): void {
    this.peladaId = this.route.snapshot.paramMap.get('id') || '';
    if (!this.peladaId) {
      return;
    }

    this.loadData();
  }

  get isConcluded(): boolean {
    return (this.pelada?.status || 'OPEN') === 'CONCLUDED';
  }

  loadData(): void {
    this.loading = true;

    forkJoin({
      pelada: this.peladaService.getPelada(this.peladaId),
      users: this.userService.getUsers(),
      rating: this.peladaService.getRatingCards(this.peladaId),
      votes: this.authService.isAdmin ? this.peladaService.getVoteDetails(this.peladaId) : of(null)
    }).subscribe({
      next: ({ pelada, users, rating, votes }) => {
        this.pelada = this.normalizePeladaPlayerImages(pelada);
        this.users = users;
        this.lastDrawResult = null;

        this.buildTeamForm(pelada);
        this.syncDrawFormWithCurrentTeams(pelada);
        this.buildResultsForm(pelada);
        this.buildStatsForm(pelada);
        this.buildTournamentForm(pelada);
        this.buildPresenceConfigForm(this.pelada);
        this.applyRatingCards(rating);
        this.applyVoteDetails(votes?.votes || []);
        this.updateFormEditability();

        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao carregar detalhes do racha.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  private buildTeamForm(pelada: PeladaDetail): void {
    this.teamsArray.clear();

    const existingTeams = pelada.teams || [];
    const totalTeams =
      existingTeams.length > 0
        ? Math.min(this.maxTeamsPerRacha, existingTeams.length)
        : this.maxTeamsPerRacha;

    for (let index = 0; index < totalTeams; index += 1) {
      const team = existingTeams[index];
      this.teamsArray.push(this.createTeamGroup(team));
    }

    this.normalizeTeamSelections();
  }

  private createTeamGroup(team?: PeladaDetail['teams'][number]) {
    const guestPlayers = (team?.guestPlayers || []).map((guest) => this.createGuestPlayerGroup(guest));

    return this.formBuilder.group({
      players: [team?.players?.map((player) => player.id) || [], [maxLengthArrayValidator(this.maxPlayersPerTeam)]],
      guestPlayers: this.formBuilder.array(guestPlayers),
      guestNameDraft: [''],
      guestPositionDraft: ['MEIA', [Validators.required]],
      goalkeepersText: [team?.goalkeepers?.join(', ') || '']
    });
  }

  private createGuestPlayerGroup(guest?: PeladaGuestPlayer) {
    return this.formBuilder.group({
      name: [guest?.name || '', [Validators.required]],
      position: [guest?.position || 'MEIA', [Validators.required]]
    });
  }

  private syncDrawFormWithCurrentTeams(pelada: PeladaDetail): void {
    const currentSelectedIds = this.drawSelectedPlayerIds;
    const allUserIds = new Set(this.users.map((user) => String(user.id)));
    const teamPlayerIds = Array.from(
      new Set((pelada.teams || []).flatMap((team) => (team.players || []).map((player) => String(player.id))))
    );
    const teamGuestPlayers = (pelada.teams || []).flatMap((team) => team.guestPlayers || []);
    const drawDraft = pelada.drawDraft;
    const draftPlayerIds = Array.from(
      new Set((drawDraft?.playerIds || []).map((playerId) => String(playerId)).filter((playerId) => allUserIds.has(playerId)))
    );
    const draftGuestPlayers = (drawDraft?.guestPlayers || [])
      .map((guest, index) => ({
        id: `draft-guest-${index + 1}`,
        name: String(guest?.name || '').trim(),
        rating: Number(guest?.rating || 3),
        position: (guest?.position as PlayerPosition) || 'MEIA',
        stamina: (guest?.stamina as PlayerStamina) || 'MEDIA'
      }))
      .filter((guest) => Boolean(guest.name));

    const validCurrentSelection = currentSelectedIds.filter((playerId) => allUserIds.has(playerId));
    const nextPlayerIds =
      teamPlayerIds.length > 0 ? teamPlayerIds : draftPlayerIds.length > 0 ? draftPlayerIds : validCurrentSelection;
    const nextTeamCount =
      teamPlayerIds.length > 0
        ? Math.min(this.maxTeamsPerRacha, Math.max(2, (pelada.teams || []).length))
        : drawDraft?.teamCount
          ? Math.min(this.maxTeamsPerRacha, Math.max(2, Number(drawDraft.teamCount)))
        : this.drawTeamCount;
    const maxPlayersByTeamCount = nextTeamCount * this.maxPlayersPerTeam;
    const nextGuestPlayersSource =
      teamGuestPlayers.length > 0
        ? teamGuestPlayers.map((guest, index) => ({
            id: `team-guest-${index + 1}`,
            name: String(guest?.name || '').trim(),
            rating: 3,
            position: (guest?.position as PlayerPosition) || 'MEIA',
            stamina: 'MEDIA' as PlayerStamina
          }))
        : draftGuestPlayers;

    this.drawGuestPlayers =
      nextGuestPlayersSource.length > 0 ? nextGuestPlayersSource.slice(0, maxPlayersByTeamCount) : [];

    const availableRegisteredSlots = Math.max(maxPlayersByTeamCount - this.drawGuestPlayers.length, 0);

    this.drawTeamsForm.patchValue(
      {
        teamCount: nextTeamCount,
        playerIds: nextPlayerIds.slice(0, availableRegisteredSlots),
        guestNameDraft: '',
        guestRatingDraft: 3,
        guestPositionDraft: 'MEIA',
        guestStaminaDraft: 'MEDIA'
      },
      { emitEvent: false }
    );
  }

  onDrawPlayersSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.drawPlayersSearchTerm = String(target?.value || '');
  }

  clearDrawPlayersSearch(): void {
    this.drawPlayersSearchTerm = '';
  }

  isDrawPlayerSelected(playerId: string): boolean {
    return this.drawSelectedPlayerIds.includes(String(playerId));
  }

  toggleDrawPlayerSelection(playerId: string): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    const normalizedId = String(playerId);
    const currentSelection = this.drawSelectedPlayerIds;
    const isSelected = currentSelection.includes(normalizedId);

    if (isSelected) {
      this.drawTeamsForm
        .get('playerIds')
        ?.setValue(currentSelection.filter((item) => item !== normalizedId), { emitEvent: false });
      return;
    }

    if (this.isDrawPlayerDisabled(normalizedId)) {
      this.snackBar.open(
        `Limite de atletas atingido para ${this.drawTeamCount} times (${this.maxDrawPlayersCount}).`,
        'Fechar',
        { duration: 2800 }
      );
      return;
    }

    this.drawTeamsForm.get('playerIds')?.setValue([...currentSelection, normalizedId], { emitEvent: false });
  }

  selectFilteredDrawPlayers(): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    const currentSelection = this.drawSelectedPlayerIds;
    const selectedSet = new Set(currentSelection);
    const candidates = this.filteredUsersForDraw
      .map((user) => String(user.id))
      .filter((playerId) => !selectedSet.has(playerId));

    if (candidates.length === 0) {
      this.snackBar.open('Nenhum jogador novo no filtro para selecionar.', 'Fechar', {
        duration: 2200
      });
      return;
    }

    const availableSlots = Math.max(
      this.maxDrawPlayersCount - this.drawGuestPlayers.length - currentSelection.length,
      0
    );
    if (availableSlots <= 0) {
      this.snackBar.open(
        `Limite de atletas atingido para ${this.drawTeamCount} times (${this.maxDrawPlayersCount}).`,
        'Fechar',
        { duration: 2800 }
      );
      return;
    }

    const toAdd = candidates.slice(0, availableSlots);
    this.drawTeamsForm.get('playerIds')?.setValue([...currentSelection, ...toAdd], { emitEvent: false });

    if (toAdd.length < candidates.length) {
      this.snackBar.open(
        `Foram adicionados ${toAdd.length} jogadores. Limite total de atletas atingido.`,
        'Fechar',
        { duration: 3000 }
      );
      return;
    }

    this.snackBar.open(`${toAdd.length} jogador(es) adicionados ao sorteio.`, 'Fechar', {
      duration: 2200
    });
  }

  onDrawTeamCountChanged(): void {
    const maxPlayers = this.maxDrawPlayersCount;
    let changed = false;

    if (this.drawGuestPlayers.length > maxPlayers) {
      this.drawGuestPlayers = this.drawGuestPlayers.slice(0, maxPlayers);
      changed = true;
    }

    const allowedRegisteredPlayers = Math.max(maxPlayers - this.drawGuestPlayers.length, 0);
    const selectedIds = this.drawSelectedPlayerIds;
    if (selectedIds.length > allowedRegisteredPlayers) {
      this.drawTeamsForm
        .get('playerIds')
        ?.setValue(selectedIds.slice(0, allowedRegisteredPlayers), { emitEvent: false });
      changed = true;
    }

    if (changed) {
      this.snackBar.open(
        `Com ${this.drawTeamCount} times, o sorteio aceita no máximo ${maxPlayers} atletas no total.`,
        'Fechar',
        {
          duration: 3200
        }
      );
    }
  }

  isDrawPlayerDisabled(playerId: string): boolean {
    const selected = this.drawSelectedPlayerIds;
    const normalizedId = String(playerId);
    if (selected.includes(normalizedId)) {
      return false;
    }
    return this.drawPoolCount >= this.maxDrawPlayersCount;
  }

  drawPlayerPositionLabel(position?: PlayerPosition): string {
    if (position === 'ZAGUEIRO') return 'ZAG';
    if (position === 'MEIA') return 'MEI';
    if (position === 'ATACANTE') return 'ATA';
    return 'SEM POS';
  }

  drawPlayerStaminaLabel(stamina?: PlayerStamina): string {
    if (stamina === 'BAIXA') return 'BAIXA';
    if (stamina === 'ALTA') return 'ALTA';
    return 'MÉDIA';
  }

  drawPlayerMeta(user: User): string {
    const position = this.drawPlayerPositionLabel(user.position);
    const stamina = this.drawPlayerStaminaLabel(user.stamina);
    const rating =
      typeof user.ratingAverage === 'number' && Number.isFinite(user.ratingAverage)
        ? user.ratingAverage.toFixed(2).replace('.', ',')
        : '--';

    return `${position} • stamina ${stamina} • nota ${rating}`;
  }

  addDrawGuestPlayer(): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    if (!this.canAddDrawGuestPlayer) {
      this.snackBar.open(
        `Limite do sorteio atingido para ${this.drawTeamCount} times (${this.maxDrawPlayersCount} atletas).`,
        'Fechar',
        {
          duration: 3000
        }
      );
      return;
    }

    const guestNameControl = this.drawTeamsForm.get('guestNameDraft');
    const guestRatingControl = this.drawTeamsForm.get('guestRatingDraft');
    const guestPositionControl = this.drawTeamsForm.get('guestPositionDraft');
    const guestStaminaControl = this.drawTeamsForm.get('guestStaminaDraft');

    const guestName = String(guestNameControl?.value || '')
      .trim()
      .replace(/\s+/g, ' ');
    const guestRating = Number(guestRatingControl?.value);
    const guestPosition = String(guestPositionControl?.value || '')
      .trim()
      .toUpperCase() as PlayerPosition;
    const guestStamina = String(guestStaminaControl?.value || 'MEDIA')
      .trim()
      .toUpperCase() as PlayerStamina;

    if (!guestName) {
      guestNameControl?.markAsTouched();
      this.snackBar.open('Digite o nome do convidado para o sorteio.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    if (!Number.isFinite(guestRating) || guestRating < 1 || guestRating > 5) {
      guestRatingControl?.markAsTouched();
      this.snackBar.open('A nota do convidado deve ficar entre 1 e 5.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    const validPositions: PlayerPosition[] = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];
    const validStaminas: PlayerStamina[] = ['BAIXA', 'MEDIA', 'ALTA'];
    if (!validPositions.includes(guestPosition)) {
      guestPositionControl?.markAsTouched();
      this.snackBar.open('Selecione uma posição válida para o convidado.', 'Fechar', {
        duration: 2600
      });
      return;
    }
    if (!validStaminas.includes(guestStamina)) {
      guestStaminaControl?.markAsTouched();
      this.snackBar.open('Selecione uma stamina válida para o convidado.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    this.drawGuestPlayers.push({
      id: `draw-guest-${Date.now()}-${Math.round(Math.random() * 100000)}`,
      name: guestName,
      rating: Number(guestRating.toFixed(2)),
      position: guestPosition,
      stamina: guestStamina
    });

    guestNameControl?.setValue('', { emitEvent: false });
    guestRatingControl?.setValue(3, { emitEvent: false });
    guestPositionControl?.setValue('MEIA', { emitEvent: false });
    guestStaminaControl?.setValue('MEDIA', { emitEvent: false });
  }

  removeDrawGuestPlayer(guestId: string): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    this.drawGuestPlayers = this.drawGuestPlayers.filter((guest) => guest.id !== String(guestId));
  }

  removeDrawRegisteredPlayer(playerId: string): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    const normalizedId = String(playerId);
    const nextSelection = this.drawSelectedPlayerIds.filter((item) => String(item) !== normalizedId);
    this.drawTeamsForm.get('playerIds')?.setValue(nextSelection, { emitEvent: false });
  }

  clearDrawPool(): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    this.drawTeamsForm.patchValue(
      {
        playerIds: [],
        guestNameDraft: '',
        guestRatingDraft: 3,
        guestPositionDraft: 'MEIA',
        guestStaminaDraft: 'MEDIA'
      },
      { emitEvent: false }
    );
    this.drawGuestPlayers = [];
    this.lastDrawResult = null;
  }

  drawGuestChipLabel(guest: DrawGuestPlayer): string {
    const labelPosition = this.drawPlayerPositionLabel(guest.position);
    const labelStamina = this.drawPlayerStaminaLabel(guest.stamina);
    const labelRating = Number(guest.rating || 0).toFixed(2).replace('.', ',');
    return `${toPlayerDisplayName(guest.name)} • ${labelPosition} • stamina ${labelStamina} • nota ${labelRating}`;
  }

  drawTeamPlayersPreview(team: TeamsDrawResponse['teams'][number]): string {
    return (team.players || [])
      .map((player) => `${toPlayerDisplayName(player.name)}${player.isGuest ? ' (Convidado)' : ''}`)
      .join(', ');
  }

  addTeamSlot(): void {
    if (this.actionLoading || this.isConcluded || this.teamsArray.length >= this.maxTeamsPerRacha) {
      return;
    }

    this.teamsArray.push(this.createTeamGroup());
  }

  removeTeamSlot(teamIndex: number): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    if (this.teamsArray.length <= 1) {
      this.snackBar.open('É necessário manter ao menos um time.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    if (teamIndex < 0 || teamIndex >= this.teamsArray.length) {
      return;
    }

    this.teamsArray.removeAt(teamIndex);
    this.normalizeTeamSelections();
  }

  teamDisplayName(teamIndex: number): string {
    return `Time ${teamIndex + 1}`;
  }

  guestPlayersArray(teamIndex: number): UntypedFormArray {
    return this.teamsArray.at(teamIndex).get('guestPlayers') as UntypedFormArray;
  }

  addGuestPlayer(teamIndex: number): void {
    if (this.actionLoading || this.isConcluded || !this.canAddGuestPlayer(teamIndex)) {
      return;
    }

    const teamGroup = this.teamsArray.at(teamIndex);
    const draftNameControl = teamGroup.get('guestNameDraft');
    const draftPositionControl = teamGroup.get('guestPositionDraft');

    const guestName = String(draftNameControl?.value || '')
      .trim()
      .replace(/\s+/g, ' ');
    const guestPosition = String(draftPositionControl?.value || 'MEIA')
      .trim()
      .toUpperCase() as PlayerPosition;
    const validPositions: PlayerPosition[] = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];

    if (!guestName) {
      draftNameControl?.markAsTouched();
      this.snackBar.open('Digite o nome do convidado antes de adicionar.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    if (!validPositions.includes(guestPosition)) {
      this.snackBar.open('Selecione uma posição válida para o convidado.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    this.guestPlayersArray(teamIndex).push(
      this.createGuestPlayerGroup({
        name: guestName,
        position: guestPosition
      })
    );

    draftNameControl?.setValue('', { emitEvent: false });
    draftPositionControl?.setValue('MEIA', { emitEvent: false });
  }

  removeGuestPlayer(teamIndex: number, guestIndex: number): void {
    if (this.actionLoading || this.isConcluded) {
      return;
    }

    const guestsArray = this.guestPlayersArray(teamIndex);
    if (guestIndex < 0 || guestIndex >= guestsArray.length) {
      return;
    }

    guestsArray.removeAt(guestIndex);
  }

  private getTeamPlayerIds(teamIndex: number): string[] {
    const control = this.teamsArray.at(teamIndex)?.get('players');
    const value = control?.value;

    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((playerId) => String(playerId));
  }

  private normalizeTeamSelections(): void {
    const usedPlayers = new Set<string>();

    for (let index = 0; index < this.teamsArray.length; index += 1) {
      const control = this.teamsArray.at(index)?.get('players');
      const currentPlayers = this.getTeamPlayerIds(index);
      const uniquePlayers: string[] = [];

      for (const playerId of currentPlayers) {
        if (usedPlayers.has(playerId)) {
          continue;
        }
        usedPlayers.add(playerId);
        uniquePlayers.push(playerId);
      }

      if (uniquePlayers.length !== currentPlayers.length) {
        control?.setValue(uniquePlayers, { emitEvent: false });
      }
    }
  }

  isPlayerUnavailableForTeam(playerId: string, currentTeamIndex: number): boolean {
    const normalizedPlayerId = String(playerId);
    const currentTeamPlayers = this.getTeamPlayerIds(currentTeamIndex);

    if (currentTeamPlayers.includes(normalizedPlayerId)) {
      return false;
    }

    if (this.totalTeamPlayersCount(currentTeamIndex) >= this.maxPlayersPerTeam) {
      return true;
    }

    for (let index = 0; index < this.teamsArray.length; index += 1) {
      if (index === currentTeamIndex) {
        continue;
      }

      if (this.getTeamPlayerIds(index).includes(normalizedPlayerId)) {
        return true;
      }
    }

    return false;
  }

  onTeamPlayersChanged(changedTeamIndex: number): void {
    const selectedOnChangedTeam = new Set(this.getTeamPlayerIds(changedTeamIndex));

    for (let index = 0; index < this.teamsArray.length; index += 1) {
      if (index === changedTeamIndex) {
        continue;
      }

      const control = this.teamsArray.at(index)?.get('players');
      const currentPlayers = this.getTeamPlayerIds(index);
      const filteredPlayers = currentPlayers.filter((playerId) => !selectedOnChangedTeam.has(playerId));

      if (filteredPlayers.length !== currentPlayers.length) {
        control?.setValue(filteredPlayers, { emitEvent: false });
      }
    }
  }

  getSelectedPlayersForTeam(teamIndex: number): string[] {
    const selectedIds = this.getTeamPlayerIds(teamIndex);
    const usersById = new Map(this.users.map((user) => [user.id, user]));

    return selectedIds
      .map((userId) => toPlayerDisplayName(usersById.get(userId)?.name))
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
  }

  getRegisteredPlayersCount(teamIndex: number): number {
    return this.getTeamPlayerIds(teamIndex).length;
  }

  getGuestPlayersCount(teamIndex: number): number {
    return this.guestPlayersArray(teamIndex).length;
  }

  totalTeamPlayersCount(teamIndex: number): number {
    return this.getRegisteredPlayersCount(teamIndex) + this.getGuestPlayersCount(teamIndex);
  }

  canAddGuestPlayer(teamIndex: number): boolean {
    return this.totalTeamPlayersCount(teamIndex) < this.maxPlayersPerTeam;
  }

  private buildResultsForm(pelada: PeladaDetail): void {
    this.resultsArray.clear();

    for (const team of pelada.teams || []) {
      this.resultsArray.push(
        this.formBuilder.group({
          teamId: [team.id],
          teamName: [team.name],
          wins: [team.wins || 0, [Validators.min(0), Validators.max(10)]],
          draws: [team.draws || 0, [Validators.min(0), Validators.max(10)]],
          losses: [team.losses || 0, [Validators.min(0), Validators.max(10)]]
        })
      );
    }
  }

  private buildStatsForm(pelada: PeladaDetail): void {
    this.statsArray.clear();

    const participantMap = new Map<string, { name: string }>();
    for (const team of pelada.teams || []) {
      for (const player of team.players || []) {
        participantMap.set(player.id, { name: player.name });
      }
    }

    const currentStats = new Map(pelada.playerStats.map((stat) => [stat.playerId, stat]));

    for (const [playerId, player] of participantMap.entries()) {
      const stat = currentStats.get(playerId);
      this.statsArray.push(
        this.formBuilder.group({
          playerId: [playerId],
          playerName: [player.name],
          goals: [stat?.goals || 0, [Validators.min(0), Validators.max(15)]],
          assists: [stat?.assists || 0, [Validators.min(0), Validators.max(15)]]
        })
      );
    }

    this.playerStatsSearchTerm = '';
  }

  private buildTournamentForm(pelada: PeladaDetail): void {
    this.tournamentMatchesArray.clear();
    this.tournamentRoundGroups = [];

    if (pelada.type !== 'TOURNAMENT') {
      return;
    }

    const roundMap = new Map<number, number[]>();

    for (const match of pelada.tournament?.matches || []) {
      const formIndex = this.tournamentMatchesArray.length;
      this.tournamentMatchesArray.push(
        this.formBuilder.group({
          matchId: [match.id],
          round: [match.round],
          homeTeamName: [match.homeTeamName],
          awayTeamName: [match.awayTeamName],
          homeGoals: [match.homeGoals, [Validators.min(0)]],
          awayGoals: [match.awayGoals, [Validators.min(0)]]
        })
      );

      const round = Number(match.round || 1);
      if (!roundMap.has(round)) {
        roundMap.set(round, []);
      }
      roundMap.get(round)?.push(formIndex);
    }

    this.tournamentRoundGroups = Array.from(roundMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, matchIndexes]) => ({ round, matchIndexes }));
  }

  private buildPresenceConfigForm(pelada: PeladaDetail | null): void {
    const openAtValue = this.toLocalDateTimeInputValue(pelada?.presence?.openAt || null);
    this.presenceConfigForm.patchValue(
      {
        openAt: openAtValue
      },
      { emitEvent: false }
    );
  }

  private applyRatingCards(rating: RatingCardsResponse): void {
    this.ratingCards = rating.cards.map((card) => ({
      ...card,
      profileImageUrl: toAbsoluteProfileImageUrl(card.profileImageUrl)
    }));
    this.myMatchRating =
      typeof rating.myMatchRating === 'number' && Number.isFinite(rating.myMatchRating)
        ? rating.myMatchRating
        : null;
    this.canCurrentUserVote = rating.canCurrentUserVote;
    this.canCurrentUserVoteCraque = rating.canCurrentUserVoteCraque;
    this.ratingFlowQueue = this.ratingCards.filter((card) => card.canVote);
    this.ratingFlowSelectedScore = null;
    this.ratingFlowAnimating = false;
    this.ratingFlowSwipeDirection = null;
    this.voteSelections = {};
    this.craqueVoteSelections = rating.myCraqueVote
      ? { ...rating.myCraqueVote }
      : this.emptyCraqueVoteSelections();
  }

  private applyVoteDetails(votes: VoteDetail[]): void {
    this.adminVoteSelections = {};
    for (const vote of votes) {
      this.adminVoteSelections[this.voteEditKey(vote)] = vote.score;
    }

    const groupsMap = new Map<string, { toUserId: string; toUserName: string; votes: VoteDetail[] }>();

    for (const vote of votes) {
      const key = vote.toUserId;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          toUserId: vote.toUserId,
          toUserName: vote.toUserName,
          votes: []
        });
      }
      groupsMap.get(key)?.votes.push(vote);
    }

    this.voteGroups = Array.from(groupsMap.values())
      .map((group) => ({
        ...group,
        votes: group.votes.sort((a, b) => a.fromUserName.localeCompare(b.fromUserName))
      }))
      .sort((a, b) => a.toUserName.localeCompare(b.toUserName));
  }

  private updateFormEditability(): void {
    if (this.isConcluded) {
      this.teamForm.disable({ emitEvent: false });
      this.resultsForm.disable({ emitEvent: false });
      this.statsForm.disable({ emitEvent: false });
      this.tournamentForm.disable({ emitEvent: false });
      this.presenceConfigForm.disable({ emitEvent: false });
      this.drawTeamsForm.disable({ emitEvent: false });
      return;
    }

    this.teamForm.enable({ emitEvent: false });
    this.resultsForm.enable({ emitEvent: false });
    this.statsForm.enable({ emitEvent: false });
    this.tournamentForm.enable({ emitEvent: false });
    this.drawTeamsForm.enable({ emitEvent: false });

    if (this.canConfigurePresence) {
      this.presenceConfigForm.enable({ emitEvent: false });
    } else {
      this.presenceConfigForm.disable({ emitEvent: false });
    }
  }

  private ensureNotConcluded(): boolean {
    if (!this.isConcluded) {
      return true;
    }

    this.snackBar.open('Este racha foi concluído e não permite novos ajustes.', 'Fechar', {
      duration: 2800
    });
    return false;
  }

  private emptyCraqueVoteSelections(): CraqueVoteSelection {
    return {
      firstUserId: '',
      secondUserId: '',
      thirdUserId: ''
    };
  }

  isCraqueOptionDisabled(
    playerId: string,
    slot: keyof CraqueVoteSelection
  ): boolean {
    const currentSlotValue = this.craqueVoteSelections[slot];
    if (currentSlotValue === playerId) {
      return false;
    }

    return (
      this.craqueVoteSelections.firstUserId === playerId ||
      this.craqueVoteSelections.secondUserId === playerId ||
      this.craqueVoteSelections.thirdUserId === playerId
    );
  }

  hasMyCraqueVote(): boolean {
    return Boolean(
      this.craqueVoteSelections.firstUserId &&
        this.craqueVoteSelections.secondUserId &&
        this.craqueVoteSelections.thirdUserId
    );
  }

  craqueVotePlayerName(userId: string): string {
    const normalizedId = String(userId || '');
    if (!normalizedId) {
      return 'Jogador removido';
    }

    const card = this.ratingCards.find((item) => item.playerId === normalizedId);
    if (card?.name) {
      return toPlayerDisplayName(card.name);
    }

    const user = this.users.find((item) => item.id === normalizedId);
    if (user?.name) {
      return toPlayerDisplayName(user.name);
    }

    return 'Jogador removido';
  }

  drawTeams(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.actionLoading || !this.pelada) {
      return;
    }

    const selectedIds = this.drawSelectedPlayerIds;
    const uniqueSelectedIds = Array.from(new Set(selectedIds));
    const guestPlayers = this.drawGuestPlayers.map((guest) => ({
      name: String(guest.name || '')
        .trim()
        .replace(/\s+/g, ' '),
      rating: Number(guest.rating),
      position: guest.position,
      stamina: guest.stamina
    }));
    const teamCount = this.drawTeamCount;
    const maxAllowedPlayers = teamCount * this.maxPlayersPerTeam;
    const totalSelected = uniqueSelectedIds.length + guestPlayers.length;

    if (uniqueSelectedIds.length !== selectedIds.length) {
      this.snackBar.open('Selecione cada jogador apenas uma vez para o sorteio.', 'Fechar', {
        duration: 2600
      });
      return;
    }

    if (totalSelected < teamCount) {
      this.snackBar.open(`Selecione pelo menos ${teamCount} atletas para formar os times.`, 'Fechar', {
        duration: 2800
      });
      return;
    }

    if (totalSelected > maxAllowedPlayers) {
      this.snackBar.open(
        `Com ${teamCount} times, o limite do sorteio é ${maxAllowedPlayers} atletas.`,
        'Fechar',
        { duration: 3000 }
      );
      return;
    }

    this.actionLoading = true;
    this.peladaService
      .drawBalancedTeams(this.peladaId, {
        playerIds: uniqueSelectedIds,
        teamCount,
        guestPlayers
      })
      .subscribe({
        next: (response) => {
          this.lastDrawResult = response;
          this.applyDrawnTeamsToForm(response);
          this.actionLoading = false;
          this.snackBar.open(
            'Times sorteados com equilíbrio de nota, posição e stamina. Revise e clique em Salvar times.',
            'Fechar',
            {
              duration: 3800
            }
          );
        },
        error: (error) => {
          this.actionLoading = false;
          this.snackBar.open(error?.error?.message || 'Falha ao sortear times.', 'Fechar', {
            duration: 3200
          });
        }
      });
  }

  private applyDrawnTeamsToForm(drawResult: TeamsDrawResponse): void {
    this.teamsArray.clear();
    const registeredUserIds = new Set(this.users.map((user) => String(user.id)));

    for (const team of drawResult.teams || []) {
      const teamGroup = this.createTeamGroup();
      const guestsArray = teamGroup.get('guestPlayers') as UntypedFormArray;
      guestsArray.clear();

      const registeredPlayers: string[] = [];
      for (const player of team.players || []) {
        const isGuest = Boolean(player.isGuest) || !registeredUserIds.has(String(player.id));
        if (isGuest) {
          guestsArray.push(
            this.createGuestPlayerGroup({
              name: String(player.name || '').trim(),
              position: (player.position as PlayerPosition) || 'MEIA'
            })
          );
          continue;
        }

        registeredPlayers.push(String(player.id));
      }

      teamGroup.patchValue(
        {
          players: registeredPlayers,
          goalkeepersText: ''
        },
        { emitEvent: false }
      );

      this.teamsArray.push(teamGroup);
    }

    this.normalizeTeamSelections();
  }

  saveTeams(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.teamForm.invalid || this.actionLoading || !this.pelada) {
      this.teamForm.markAllAsTouched();
      return;
    }

    const rawTeams = this.teamsArray.getRawValue() as Array<{
      players: string[];
      guestPlayers: Array<{ name: string; position: PlayerPosition }>;
      goalkeepersText: string;
    }>;

    const activeTeams = rawTeams
      .map((team) => ({
        players: Array.isArray(team.players) ? team.players.map((playerId) => String(playerId)) : [],
        guestPlayers: Array.isArray(team.guestPlayers) ? team.guestPlayers : [],
        goalkeepers: String(team.goalkeepersText || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      }))
      .filter((team) => team.players.length + team.guestPlayers.length > 0);

    if (activeTeams.length < 1) {
      this.snackBar.open('Adicione ao menos 1 time com jogadores cadastrados ou convidados.', 'Fechar', {
        duration: 3200
      });
      return;
    }

    const players = activeTeams.flatMap((team) => team.players || []);
    if (new Set(players).size !== players.length) {
      this.snackBar.open('Um jogador não pode estar em mais de um time.', 'Fechar', {
        duration: 2800
      });
      return;
    }

    const validPositions: PlayerPosition[] = ['ZAGUEIRO', 'MEIA', 'ATACANTE'];
    for (let index = 0; index < activeTeams.length; index += 1) {
      const team = activeTeams[index];
      const teamName = this.teamDisplayName(index);
      const registeredCount = Array.isArray(team.players) ? team.players.length : 0;
      const guestPlayers = Array.isArray(team.guestPlayers) ? team.guestPlayers : [];

      if (registeredCount + guestPlayers.length > this.maxPlayersPerTeam) {
        this.snackBar.open(
          `O ${teamName} pode ter no máximo ${this.maxPlayersPerTeam} jogadores entre cadastrados e convidados.`,
          'Fechar',
          {
            duration: 3200
          }
        );
        return;
      }

      for (const guest of guestPlayers) {
        const guestName = String(guest?.name || '').trim();
        const guestPosition = String(guest?.position || '')
          .trim()
          .toUpperCase() as PlayerPosition;

        if (!guestName || !validPositions.includes(guestPosition)) {
          this.snackBar.open(
            `Todo convidado do ${teamName} precisa de nome e posição válidos.`,
            'Fechar',
            {
              duration: 3200
            }
          );
          return;
        }
      }
    }

    this.actionLoading = true;

    const payload = activeTeams.map((team, index) => ({
      name: this.teamDisplayName(index),
      players: team.players,
      guestPlayers: (team.guestPlayers || []).map((guest) => ({
        name: String(guest.name || '').trim(),
        position: String(guest.position || '')
          .trim()
          .toUpperCase() as PlayerPosition
      })),
      goalkeepers: team.goalkeepers
    }));

    this.peladaService.updateTeams(this.peladaId, payload).subscribe({
      next: () => {
        this.snackBar.open('Times atualizados.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar times.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  saveResults(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (this.isTournament) {
      this.snackBar.open(
        'No torneio, os resultados por time são calculados automaticamente pelos confrontos.',
        'Fechar',
        { duration: 3200 }
      );
      return;
    }

    if (!this.authService.isAdmin || this.resultsForm.invalid || this.actionLoading || !this.pelada) {
      this.resultsForm.markAllAsTouched();
      return;
    }

    this.actionLoading = true;
    this.peladaService.updateResults(this.peladaId, this.resultsArray.getRawValue()).subscribe({
      next: () => {
        this.snackBar.open('Resultados atualizados.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar resultados.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  saveTournamentMatch(matchIndex: number): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.actionLoading || !this.pelada || !this.isTournament) {
      return;
    }

    const control = this.tournamentMatchesArray.at(matchIndex);
    if (!control) {
      return;
    }

    const matchId = String(control.get('matchId')?.value || '');
    const homeGoalsRaw = control.get('homeGoals')?.value;
    const awayGoalsRaw = control.get('awayGoals')?.value;

    if (
      homeGoalsRaw === null ||
      homeGoalsRaw === undefined ||
      homeGoalsRaw === '' ||
      awayGoalsRaw === null ||
      awayGoalsRaw === undefined ||
      awayGoalsRaw === ''
    ) {
      this.snackBar.open('Preencha os dois lados do placar para salvar.', 'Fechar', {
        duration: 2800
      });
      return;
    }

    const homeGoals = Number(homeGoalsRaw);
    const awayGoals = Number(awayGoalsRaw);

    if (!matchId || !Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
      this.snackBar.open('Informe placar com números inteiros >= 0 para os dois times.', 'Fechar', {
        duration: 2800
      });
      return;
    }

    this.actionLoading = true;
    this.peladaService.updateTournamentMatch(this.peladaId, matchId, homeGoals, awayGoals).subscribe({
      next: () => {
        this.snackBar.open('Placar atualizado.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar placar.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  savePlayerStats(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.statsForm.invalid || this.actionLoading || !this.pelada) {
      this.statsForm.markAllAsTouched();
      return;
    }

    const payload = this.statsArray.getRawValue().map((item: { playerId: string; goals: number; assists: number }) => ({
      playerId: item.playerId,
      goals: Number(item.goals || 0),
      assists: Number(item.assists || 0)
    }));

    this.actionLoading = true;
    this.peladaService.updatePlayerStats(this.peladaId, payload).subscribe({
      next: () => {
        this.snackBar.open('Gols e assistências atualizados.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar estatísticas.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  onPlayerStatsSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.playerStatsSearchTerm = target?.value || '';
  }

  clearPlayerStatsSearch(): void {
    this.playerStatsSearchTerm = '';
  }

  savePresenceConfig(): void {
    if (!this.canConfigurePresence || this.actionLoading || this.presenceConfigForm.invalid || !this.pelada) {
      this.presenceConfigForm.markAllAsTouched();
      return;
    }

    const openAtRaw = String(this.presenceConfigForm.get('openAt')?.value || '').trim();
    if (!openAtRaw) {
      this.snackBar.open('Informe data e horário para abrir a presença.', 'Fechar', {
        duration: 2800
      });
      return;
    }

    const parsedOpenAt = new Date(openAtRaw);
    if (Number.isNaN(parsedOpenAt.getTime())) {
      this.snackBar.open('Data/hora de abertura inválida.', 'Fechar', {
        duration: 2800
      });
      return;
    }

    this.actionLoading = true;
    this.peladaService.configurePresenceOpenAt(this.peladaId, parsedOpenAt.toISOString()).subscribe({
      next: (response) => {
        this.snackBar.open(response.message || 'Abertura de presença configurada.', 'Fechar', {
          duration: 2600
        });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao configurar presença.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  markPresence(): void {
    if (!this.canCurrentUserMarkPresence || this.actionLoading) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.confirmPresence(this.peladaId).subscribe({
      next: (response) => {
        this.snackBar.open(response.message || 'Presença marcada com sucesso.', 'Fechar', {
          duration: 2800
        });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao marcar presença.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  cancelPresence(): void {
    if (!this.canCurrentUserCancelPresence || this.actionLoading) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.cancelPresence(this.peladaId).subscribe({
      next: (response) => {
        this.snackBar.open(response.message || 'Presença removida com sucesso.', 'Fechar', {
          duration: 2800
        });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao desistir do racha.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  openVoting(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.actionLoading) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.openVoting(this.peladaId).subscribe({
      next: () => {
        this.snackBar.open('Votação aberta.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao abrir votação.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  finishVoting(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.actionLoading) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.finishVoting(this.peladaId).subscribe({
      next: () => {
        this.snackBar.open('Votação finalizada.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao finalizar votação.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  submitVote(card: RatingCard): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    const score = this.voteSelections[card.playerId];

    if (!this.isValidRatingScore(score)) {
      this.snackBar.open('Selecione uma nota válida entre 0,5 e 5,0.', 'Fechar', { duration: 2200 });
      return;
    }

    if (!card.canVote || this.actionLoading) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.vote(this.peladaId, card.playerId, score).subscribe({
      next: () => {
        this.snackBar.open('Nota registrada.', 'Fechar', { duration: 2200 });
        this.applySuccessfulVote(card.playerId);
        this.actionLoading = false;
        if (this.useRatingFlowMode && this.ratingFlowPendingCount === 0) {
          this.loadData();
        }
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao registrar nota.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  selectFlowScore(score: number): void {
    if (this.actionLoading || this.ratingFlowAnimating) {
      return;
    }
    this.ratingFlowSelectedScore = score;
  }

  skipCurrentFlowCard(): void {
    if (this.actionLoading || this.ratingFlowAnimating || this.ratingFlowQueue.length < 2) {
      return;
    }

    this.animateRatingFlow('left', () => {
      const [current, ...rest] = this.ratingFlowQueue;
      this.ratingFlowQueue = [...rest, current];
      this.ratingFlowSelectedScore = null;
    });
  }

  submitCurrentFlowVote(): void {
    if (!this.ensureNotConcluded() || !this.canCurrentUserVote) {
      return;
    }

    const currentCard = this.currentRatingFlowCard;
    if (!currentCard || this.actionLoading || this.ratingFlowAnimating) {
      return;
    }

    const score = this.ratingFlowSelectedScore;
    if (!this.isValidRatingScore(score)) {
      this.snackBar.open('Selecione uma nota válida entre 0,5 e 5,0 para continuar.', 'Fechar', {
        duration: 2200
      });
      return;
    }

    this.actionLoading = true;
    this.peladaService.vote(this.peladaId, currentCard.playerId, score).subscribe({
      next: () => {
        this.snackBar.open(`Nota registrada para ${toPlayerDisplayName(currentCard.name)}.`, 'Fechar', {
          duration: 1800
        });
        this.animateRatingFlow('right', () => {
          this.applySuccessfulVote(currentCard.playerId);
          this.ratingFlowSelectedScore = null;
          if (this.useRatingFlowMode && this.ratingFlowPendingCount === 0) {
            this.loadData();
          }
        });
        this.actionLoading = false;
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao registrar nota.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  private applySuccessfulVote(playerId: string): void {
    const targetId = String(playerId);

    const card = this.ratingCards.find((item) => item.playerId === targetId);
    if (card) {
      card.alreadyRatedByMe = true;
      card.canVote = false;
    }

    this.ratingFlowQueue = this.ratingFlowQueue.filter((item) => item.playerId !== targetId);
    delete this.voteSelections[targetId];

    if (this.pelada) {
      this.pelada = {
        ...this.pelada,
        votesCount: Number(this.pelada.votesCount || 0) + 1
      };
    }
  }

  private animateRatingFlow(direction: 'left' | 'right', onDone: () => void): void {
    this.ratingFlowAnimating = true;
    this.ratingFlowSwipeDirection = direction;

    setTimeout(() => {
      onDone();
      this.ratingFlowAnimating = false;
      this.ratingFlowSwipeDirection = null;
    }, 230);
  }

  submitCraqueVote(): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.canCurrentUserVoteCraque || this.actionLoading) {
      return;
    }

    const { firstUserId, secondUserId, thirdUserId } = this.craqueVoteSelections;
    if (!firstUserId || !secondUserId || !thirdUserId) {
      this.snackBar.open('Selecione 1º, 2º e 3º lugar do craque do racha.', 'Fechar', {
        duration: 2400
      });
      return;
    }

    if (new Set([firstUserId, secondUserId, thirdUserId]).size !== 3) {
      this.snackBar.open('Os três colocados devem ser jogadores diferentes.', 'Fechar', {
        duration: 2400
      });
      return;
    }

    if (
      this.authService.currentUser &&
      [firstUserId, secondUserId, thirdUserId].includes(this.authService.currentUser.id)
    ) {
      this.snackBar.open('Não é permitido colocar a si mesmo no pódio de craque.', 'Fechar', {
        duration: 2400
      });
      return;
    }

    this.actionLoading = true;
    this.peladaService
      .submitCraqueVote(this.peladaId, {
        firstUserId,
        secondUserId,
        thirdUserId
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Pódio de craque registrado.', 'Fechar', { duration: 2200 });
          this.actionLoading = false;
          this.loadData();
        },
        error: (error) => {
          this.actionLoading = false;
          this.snackBar.open(error?.error?.message || 'Falha ao registrar pódio de craque.', 'Fechar', {
            duration: 3200
          });
        }
      });
  }

  concludeRacha(): void {
    if (!this.authService.isAdmin || this.actionLoading || this.isConcluded) {
      return;
    }

    this.actionLoading = true;
    this.peladaService.concludeRacha(this.peladaId).subscribe({
      next: () => {
        this.snackBar.open('Racha concluído. Ajustes e notas foram bloqueados.', 'Fechar', {
          duration: 2600
        });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao concluir racha.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  voteEditKey(vote: VoteDetail): string {
    return `${vote.fromUserId}:${vote.toUserId}`;
  }

  saveAdminVote(vote: VoteDetail): void {
    if (!this.ensureNotConcluded()) {
      return;
    }

    if (!this.authService.isAdmin || this.actionLoading) {
      return;
    }

    const score = Number(this.adminVoteSelections[this.voteEditKey(vote)]);
    if (!this.isValidRatingScore(score)) {
      this.snackBar.open('Selecione uma nota válida entre 0,5 e 5,0.', 'Fechar', { duration: 2200 });
      return;
    }

    this.actionLoading = true;
    this.peladaService.adminEditVote(this.peladaId, vote.fromUserId, vote.toUserId, score).subscribe({
      next: () => {
        this.snackBar.open('Nota corrigida com sucesso.', 'Fechar', { duration: 2200 });
        this.actionLoading = false;
        this.loadData();
      },
      error: (error) => {
        this.actionLoading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao corrigir nota.', 'Fechar', {
          duration: 3200
        });
      }
    });
  }

  ratingStatusLabel(): string {
    if (!this.pelada) {
      return '-';
    }

    if (this.pelada.votingStatus === 'OPEN') {
      return 'Aberta';
    }

    if (this.pelada.votingStatus === 'FINISHED') {
      return 'Finalizada';
    }

    return 'Fechada';
  }

  rachaTypeLabel(): string {
    if (!this.pelada) {
      return '-';
    }

    return this.pelada.type === 'TOURNAMENT' ? 'Torneio' : 'Racha comum';
  }

  tournamentRoundLabel(round: number): string {
    if (round === 1) {
      return 'Jogos de ida';
    }
    if (round === 2) {
      return 'Jogos de volta';
    }
    return `Rodada ${round}`;
  }

  tournamentLeaderName(): string {
    if (!this.pelada?.tournament?.standings?.length) {
      return '-';
    }

    return this.pelada.tournament.standings[0].teamName;
  }

  isChampionTeam(teamId: string): boolean {
    return Boolean(this.isTournament && this.pelada?.tournament?.championTeamId === teamId);
  }

  teamFieldLayout(team: PeladaDetail['teams'][number]): TeamFieldLayout {
    const registeredPlayers: TeamFieldPlayer[] = (team.players || []).map((player) => ({
      id: player.id,
      name: player.name,
      profileImageUrl: player.profileImageUrl || null,
      position: player.position,
      isGuest: false
    }));
    const guestPlayers: TeamFieldPlayer[] = (team.guestPlayers || []).map((guest, index) => ({
      id: `guest-${team.id}-${index}`,
      name: guest.name,
      position: guest.position,
      isGuest: true
    }));
    const players = [...registeredPlayers, ...guestPlayers].sort((a, b) => a.name.localeCompare(b.name));

    return this.buildFieldLayout(players);
  }

  selectionOfRoundFieldLayout(): TeamFieldLayout | null {
    const selectionPlayers = this.pelada?.selectionOfRound?.players || [];
    if (selectionPlayers.length === 0) {
      return null;
    }

    const players: TeamFieldPlayer[] = selectionPlayers.map((player: SelectionOfRoundPlayer) => ({
      id: player.id,
      name: player.name,
      profileImageUrl: player.profileImageUrl || null,
      position: player.position,
      isGuest: false
    }));

    return this.buildFieldLayout(players);
  }

  private buildFieldLayout(players: TeamFieldPlayer[]): TeamFieldLayout {
    const lines: Record<FieldLine, TeamFieldPlayer[]> = {
      DEFENSE: [],
      MIDFIELD: [],
      ATTACK: []
    };
    const maxPerLine = 2;
    const unassigned: TeamFieldPlayer[] = [];

    for (const player of players) {
      const preferredLine = this.preferredLineFromPosition(player.position);
      if (!preferredLine) {
        unassigned.push(player);
        continue;
      }

      const targetLine = this.selectLine(preferredLine, lines, maxPerLine);
      lines[targetLine].push(player);
    }

    for (const player of unassigned) {
      const fallbackLine = this.smallestLine(lines, ['MIDFIELD', 'DEFENSE', 'ATTACK'], maxPerLine);
      lines[fallbackLine].push(player);
    }

    this.ensureMinOnePerLine(lines);

    return {
      defense: lines.DEFENSE,
      midfield: lines.MIDFIELD,
      attack: lines.ATTACK
    };
  }

  playerShortName(name: string): string {
    return toPlayerDisplayName(name);
  }

  async exportTeamsImage(): Promise<void> {
    if (!this.pelada || this.pelada.teams.length === 0 || this.exportingTeamsImage) {
      return;
    }

    this.exportingTeamsImage = true;
    try {
      const blob = await this.buildTeamsExportImageBlob(this.pelada.teams);
      const copiedToClipboard = await this.copyImageBlobToClipboard(blob);

      if (copiedToClipboard) {
        this.snackBar.open('Imagem dos times copiada para a área de transferência.', 'Fechar', {
          duration: 3200
        });
        return;
      }

      this.downloadImageBlob(blob, this.teamsExportFileName(this.pelada.date));
      this.snackBar.open('Imagem gerada e baixada em PNG.', 'Fechar', {
        duration: 3200
      });
    } catch {
      this.snackBar.open('Não foi possível exportar os times agora. Tente novamente.', 'Fechar', {
        duration: 3200
      });
    } finally {
      this.exportingTeamsImage = false;
    }
  }

  formatMatchScore(homeGoals: number | null, awayGoals: number | null): string {
    if (homeGoals === null || awayGoals === null) {
      return 'x';
    }

    return `${homeGoals} x ${awayGoals}`;
  }

  formatGuestPlayers(guestPlayers: PeladaGuestPlayer[]): string {
    return (guestPlayers || [])
      .map((guest) => `${toPlayerDisplayName(guest.name)} (${this.positionLabel(guest.position)})`)
      .join(', ');
  }

  guestPlayerChipLabel(teamIndex: number, guestIndex: number): string {
    const guest = this.guestPlayersArray(teamIndex).at(guestIndex)?.value as
      | { name?: string; position?: PlayerPosition }
      | undefined;
    const guestName = toPlayerDisplayName(String(guest?.name || 'Convidado'));
    const guestPosition = this.positionLabel(guest?.position);
    return `${guestName} (${guestPosition})`;
  }

  presenceStatusLabel(entry: PresenceEntry): string {
    return entry.isWaitingList ? 'Lista de espera' : 'Confirmado';
  }

  myPresenceLabel(): string {
    const order = Number(this.presenceInfo?.myEntry?.order || 0);
    if (!order) {
      return '';
    }

    if (order <= Number(this.presenceInfo?.limit || 20)) {
      return `Você confirmou presença na ${order}ª posição.`;
    }

    return `Você está na lista de Suplentes. Posição: ${order}`;
  }

  goToSection(sectionId: string): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const target = document.getElementById(String(sectionId || ''));
    if (!target) {
      return;
    }

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  onQuickNavSelectionChange(sectionId: string): void {
    const normalizedSection = String(sectionId || '').trim();
    if (!normalizedSection) {
      return;
    }

    this.mobileQuickNavSelection = normalizedSection;
    this.goToSection(normalizedSection);

    setTimeout(() => {
      this.mobileQuickNavSelection = '';
    }, 180);
  }

  formatRatingScore(score: number): string {
    return Number(score).toFixed(1).replace('.', ',');
  }

  private isValidRatingScore(score: unknown): score is number {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore) || numericScore < 0.5 || numericScore > 5) {
      return false;
    }

    return Math.abs(numericScore * 2 - Math.round(numericScore * 2)) < 1e-9;
  }

  private normalizeSearch(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private toLocalDateTimeInputValue(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
  }

  private preferredLineFromPosition(position?: PlayerPosition): FieldLine | null {
    if (position === 'ZAGUEIRO') return 'DEFENSE';
    if (position === 'MEIA') return 'MIDFIELD';
    if (position === 'ATACANTE') return 'ATTACK';
    return null;
  }

  private selectLine(
    preferredLine: FieldLine,
    lines: Record<FieldLine, TeamFieldPlayer[]>,
    maxPerLine: number
  ): FieldLine {
    if (lines[preferredLine].length < maxPerLine) {
      return preferredLine;
    }

    const overflowOrderByLine: Record<FieldLine, FieldLine[]> = {
      DEFENSE: ['MIDFIELD', 'ATTACK'],
      MIDFIELD: ['ATTACK', 'DEFENSE'],
      ATTACK: ['MIDFIELD', 'DEFENSE']
    };

    for (const candidate of overflowOrderByLine[preferredLine]) {
      if (lines[candidate].length < maxPerLine) {
        return candidate;
      }
    }

    return this.smallestLine(lines, overflowOrderByLine[preferredLine]);
  }

  private smallestLine(
    lines: Record<FieldLine, TeamFieldPlayer[]>,
    priorityOrder: FieldLine[],
    maxPerLine?: number
  ): FieldLine {
    const candidates = priorityOrder.filter(
      (line) => maxPerLine === undefined || lines[line].length < maxPerLine
    );
    const source = candidates.length > 0 ? candidates : priorityOrder;

    return source.reduce((best, current) => {
      if (lines[current].length < lines[best].length) {
        return current;
      }
      return best;
    }, source[0]);
  }

  private ensureMinOnePerLine(lines: Record<FieldLine, TeamFieldPlayer[]>): void {
    const required: FieldLine[] = ['DEFENSE', 'MIDFIELD', 'ATTACK'];

    for (const targetLine of required) {
      if (lines[targetLine].length > 0) {
        continue;
      }

      const donor = required
        .filter((line) => line !== targetLine && lines[line].length > 1)
        .sort((a, b) => lines[b].length - lines[a].length)[0];

      if (!donor) {
        continue;
      }

      const movedPlayer = lines[donor].pop();
      if (movedPlayer) {
        lines[targetLine].push(movedPlayer);
      }
    }
  }

  private positionLabel(position?: PlayerPosition): string {
    if (position === 'ZAGUEIRO') return 'Zagueiro';
    if (position === 'MEIA') return 'Meia';
    if (position === 'ATACANTE') return 'Atacante';
    return '-';
  }

  private teamsExportFileName(dateValue: string): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return 'racha-times.png';
    }

    const dateLabel = date.toISOString().slice(0, 10);
    return `racha-times-${dateLabel}.png`;
  }

  private async buildTeamsExportImageBlob(teams: PeladaDetail['teams']): Promise<Blob> {
    const columns = teams.length === 1 ? 1 : 2;
    const rows = Math.ceil(teams.length / columns);
    const cardWidth = 540;
    const cardHeight = 700;
    const gap = 22;
    const pagePadding = 28;
    const titleHeight = 96;

    const width = pagePadding * 2 + columns * cardWidth + (columns - 1) * gap;
    const height = titleHeight + pagePadding + rows * cardHeight + (rows - 1) * gap + pagePadding;
    const scale = 2;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Falha ao criar contexto do canvas.');
    }

    context.scale(scale, scale);

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#f6ebff');
    background.addColorStop(0.55, '#fff3e6');
    background.addColorStop(1, '#f8f6ff');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.fillStyle = '#5b21b6';
    context.font = '700 34px Arial';
    context.fillText('Racha - Formação dos Times', pagePadding, 52);

    context.fillStyle = '#7c3aed';
    context.font = '500 18px Arial';
    context.fillText(
      `Gerado em ${new Date().toLocaleString('pt-BR')}`,
      pagePadding,
      80
    );

    teams.forEach((team, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const x = pagePadding + column * (cardWidth + gap);
      const y = titleHeight + row * (cardHeight + gap);
      this.drawTeamExportCard(context, team, x, y, cardWidth, cardHeight, index);
    });

    return this.canvasToBlob(canvas);
  }

  private drawTeamExportCard(
    context: CanvasRenderingContext2D,
    team: PeladaDetail['teams'][number],
    x: number,
    y: number,
    width: number,
    height: number,
    index: number
  ): void {
    const radius = 18;
    this.drawRoundedRect(context, x, y, width, height, radius, '#ffffff', '#d8c3ff');

    const headerHeight = 78;
    const headerGradient = context.createLinearGradient(x, y, x + width, y);
    headerGradient.addColorStop(0, '#6d28d9');
    headerGradient.addColorStop(1, '#f97316');
    this.drawRoundedRect(context, x, y, width, headerHeight, radius, headerGradient, '#6d28d9');

    context.fillStyle = '#fff7ed';
    context.font = '700 28px Arial';
    context.fillText(this.teamDisplayName(index), x + 18, y + 34);
    context.font = '600 18px Arial';
    context.fillText(`${team.wins}V / ${team.draws}E / ${team.losses}D`, x + 18, y + 60);

    const pitchX = x + 16;
    const pitchY = y + headerHeight + 14;
    const pitchWidth = width - 32;
    const pitchHeight = height - headerHeight - 118;
    this.drawPitch(context, pitchX, pitchY, pitchWidth, pitchHeight);

    const layout = this.teamFieldLayout(team);
    this.drawPlayersLine(context, layout.attack, pitchX, pitchY + pitchHeight * 0.22, pitchWidth);
    this.drawPlayersLine(context, layout.midfield, pitchX, pitchY + pitchHeight * 0.5, pitchWidth);
    this.drawPlayersLine(context, layout.defense, pitchX, pitchY + pitchHeight * 0.78, pitchWidth);

    const goalkeepersLabel = team.goalkeepers?.length
      ? `Goleiros: ${team.goalkeepers.join(', ')}`
      : 'Goleiros: -';
    context.fillStyle = '#6b7280';
    context.font = '500 16px Arial';
    context.fillText(goalkeepersLabel, x + 16, y + height - 26);
  }

  private drawPitch(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    const radius = 14;
    this.drawRoundedRect(context, x, y, width, height, radius, '#2f9f12', '#ffffff');

    const stripes = 10;
    const stripeHeight = height / stripes;
    for (let index = 0; index < stripes; index += 1) {
      context.fillStyle = index % 2 === 0 ? 'rgba(82, 178, 26, 0.55)' : 'rgba(44, 130, 12, 0.45)';
      context.fillRect(x, y + index * stripeHeight, width, stripeHeight);
    }

    context.strokeStyle = 'rgba(255,255,255,0.92)';
    context.lineWidth = 2.2;

    context.beginPath();
    context.moveTo(x, y + height / 2);
    context.lineTo(x + width, y + height / 2);
    context.stroke();

    context.beginPath();
    context.arc(x + width / 2, y + height / 2, 36, 0, Math.PI * 2);
    context.stroke();

    const penaltyWidth = Math.min(width * 0.52, 148);
    const penaltyHeight = 52;
    const penaltyX = x + (width - penaltyWidth) / 2;

    context.strokeRect(penaltyX, y, penaltyWidth, penaltyHeight);
    context.strokeRect(penaltyX, y + height - penaltyHeight, penaltyWidth, penaltyHeight);
  }

  private drawPlayersLine(
    context: CanvasRenderingContext2D,
    players: TeamFieldPlayer[],
    startX: number,
    lineY: number,
    lineWidth: number
  ): void {
    if (!players || players.length === 0) {
      return;
    }

    players.forEach((player, index) => {
      const pointX = startX + ((index + 1) * lineWidth) / (players.length + 1);
      const pointY = lineY;
      const radius = 16;

      const circleGradient = context.createRadialGradient(
        pointX - 5,
        pointY - 5,
        5,
        pointX,
        pointY,
        radius
      );
      circleGradient.addColorStop(0, '#f97316');
      circleGradient.addColorStop(1, '#6d28d9');
      context.fillStyle = circleGradient;
      context.beginPath();
      context.arc(pointX, pointY, radius, 0, Math.PI * 2);
      context.fill();

      context.lineWidth = player.isGuest ? 2.5 : 1.8;
      context.strokeStyle = player.isGuest ? '#fff1f2' : '#fef3c7';
      context.stroke();

      const shortName = this.playerShortName(player.name);
      context.fillStyle = '#ffffff';
      context.font = '600 13px Arial';
      context.textAlign = 'center';
      context.fillText(shortName, pointX, pointY + 32);
      context.textAlign = 'start';
    });
  }

  private drawRoundedRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fillStyle: string | CanvasGradient,
    strokeStyle: string
  ): void {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();

    context.fillStyle = fillStyle;
    context.fill();
    context.strokeStyle = strokeStyle;
    context.lineWidth = 1.6;
    context.stroke();
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Falha ao converter canvas para imagem.'));
      }, 'image/png');
    });
  }

  private async copyImageBlobToClipboard(blob: Blob): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof ClipboardItem === 'undefined') {
      return false;
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private downloadImageBlob(blob: Blob, fileName: string): void {
    const imageUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = imageUrl;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(imageUrl), 1200);
  }

  private normalizePeladaPlayerImages(pelada: PeladaDetail): PeladaDetail {
    return {
      ...pelada,
      teams: (pelada.teams || []).map((team) => ({
        ...team,
        players: (team.players || []).map((player) => ({
          ...player,
          profileImageUrl: toAbsoluteProfileImageUrl(player.profileImageUrl)
        }))
      })),
      selectionOfRound: pelada.selectionOfRound
        ? {
            ...pelada.selectionOfRound,
            players: (pelada.selectionOfRound.players || []).map((player) => ({
              ...player,
              profileImageUrl: toAbsoluteProfileImageUrl(player.profileImageUrl)
            }))
          }
        : null,
      presence: {
        ...pelada.presence,
        entries: (pelada.presence?.entries || []).map((entry) => ({
          ...entry,
          profileImageUrl: toAbsoluteProfileImageUrl(entry.profileImageUrl)
        })),
        myEntry: pelada.presence?.myEntry
          ? {
              ...pelada.presence.myEntry,
              profileImageUrl: toAbsoluteProfileImageUrl(pelada.presence.myEntry.profileImageUrl)
            }
          : null
      }
    };
  }
}
