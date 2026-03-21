import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { PeladaSummary } from '../../models/pelada';
import { AuthService } from '../../core/services/auth.service';
import { PeladaService } from '../../core/services/pelada.service';
import { UserService } from '../../core/services/user.service';
import { PendingApprovalUser } from '../../models/user';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';

@Component({
  selector: 'app-pelada-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTableModule,
    MatSnackBarModule,
    MatProgressBarModule,
    PlayerNamePipe
  ],
  templateUrl: './pelada-list.component.html',
  styleUrls: ['./pelada-list.component.scss']
})
export class PeladaListComponent implements OnInit {
  readonly adminBroadcastMaxLength = 180;
  loading = false;
  sendingAdminPush = false;
  peladas: PeladaSummary[] = [];
  pendingUsers: PendingApprovalUser[] = [];
  approvingUserId: string | null = null;
  readonly displayedColumns = ['date', 'type', 'status', 'votingStatus', 'actions'];

  readonly createForm = this.formBuilder.group({
    date: ['', Validators.required],
    type: ['NORMAL', Validators.required]
  });

  readonly adminBroadcastForm = this.formBuilder.group({
    message: ['', [Validators.required, Validators.maxLength(this.adminBroadcastMaxLength)]]
  });

  constructor(
    public readonly authService: AuthService,
    private readonly peladaService: PeladaService,
    private readonly userService: UserService,
    private readonly formBuilder: FormBuilder,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadPeladas();
    if (this.authService.isAdmin) {
      this.loadPendingUsers();
    }
  }

  get featuredRacha(): PeladaSummary | null {
    const openRachas = this.peladas.filter((racha) => racha.status === 'OPEN');
    if (openRachas.length === 0) {
      return null;
    }

    const now = Date.now();
    const toTime = (racha: PeladaSummary) => new Date(racha.date).getTime();

    const alreadyHappenedOpen = openRachas
      .filter((racha) => toTime(racha) <= now)
      .sort((a, b) => toTime(b) - toTime(a));

    if (alreadyHappenedOpen.length > 0) {
      return alreadyHappenedOpen[0];
    }

    const upcomingOpen = openRachas
      .filter((racha) => toTime(racha) > now)
      .sort((a, b) => toTime(a) - toTime(b));

    return upcomingOpen[0] || null;
  }

  get historicalPeladas(): PeladaSummary[] {
    if (!this.featuredRacha) {
      return this.peladas;
    }

    return this.peladas.filter((racha) => racha.id !== this.featuredRacha?.id);
  }

  loadPeladas(): void {
    this.loading = true;
    this.peladaService.listPeladas().subscribe({
      next: (peladas) => {
        this.peladas = peladas;
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao carregar rachas.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  createPelada(): void {
    if (this.createForm.invalid || this.loading) {
      this.createForm.markAllAsTouched();
      return;
    }

    const { date, type } = this.createForm.getRawValue();
    if (!date || !type) {
      return;
    }

    this.loading = true;

    this.peladaService.createPelada({
      date,
      type: type as 'NORMAL' | 'TOURNAMENT'
    }).subscribe({
      next: () => {
        this.createForm.reset({
          date: '',
          type: 'NORMAL'
        });
        this.snackBar.open('Racha criado com sucesso.', 'Fechar', { duration: 2500 });
        this.loadPeladas();
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao criar racha.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  loadPendingUsers(): void {
    if (!this.authService.isAdmin) {
      return;
    }

    this.userService.getPendingUsers().subscribe({
      next: (users) => {
        this.pendingUsers = users;
      },
      error: (error) => {
        this.snackBar.open(error?.error?.message || 'Falha ao carregar aprovações pendentes.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  approveUser(userId: string): void {
    if (!this.authService.isAdmin || this.approvingUserId) {
      return;
    }

    this.approvingUserId = userId;
    this.userService.approveUser(userId).subscribe({
      next: (response) => {
        this.approvingUserId = null;
        this.snackBar.open(response?.message || 'Jogador aprovado com sucesso.', 'Fechar', {
          duration: 2500
        });
        this.loadPendingUsers();
      },
      error: (error) => {
        this.approvingUserId = null;
        this.snackBar.open(error?.error?.message || 'Falha ao aprovar jogador.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  sendAdminBroadcast(): void {
    if (!this.authService.isAdmin || this.sendingAdminPush || this.adminBroadcastForm.invalid) {
      this.adminBroadcastForm.markAllAsTouched();
      return;
    }

    const message = String(this.adminBroadcastForm.getRawValue().message || '').trim();
    if (!message) {
      this.adminBroadcastForm.markAllAsTouched();
      return;
    }

    this.sendingAdminPush = true;
    this.userService.broadcastAdminMessage(message).subscribe({
      next: (response) => {
        this.sendingAdminPush = false;
        this.adminBroadcastForm.reset({ message: '' });
        this.snackBar.open(
          `${response.message} Entregues: ${response.sent} | Falhas: ${response.failed}.`,
          'Fechar',
          { duration: 3500 }
        );
      },
      error: (error) => {
        this.sendingAdminPush = false;
        this.snackBar.open(error?.error?.message || 'Falha ao enviar notificação.', 'Fechar', {
          duration: 3500
        });
      }
    });
  }

  totalRachasCount(): number {
    return this.peladas.length;
  }

  openRachasCount(): number {
    return this.peladas.filter((racha) => racha.status === 'OPEN').length;
  }

  concludedRachasCount(): number {
    return this.peladas.filter((racha) => racha.status === 'CONCLUDED').length;
  }

  tournamentRachasCount(): number {
    return this.peladas.filter((racha) => racha.type === 'TOURNAMENT').length;
  }

  votingStatusLabel(votingStatus: PeladaSummary['votingStatus']): string {
    if (votingStatus === 'OPEN') return 'Aberta';
    if (votingStatus === 'FINISHED') return 'Finalizada';
    return 'Fechada';
  }

  rachaStatusLabel(status: PeladaSummary['status']): string {
    return status === 'CONCLUDED' ? 'Concluído' : 'Aberto';
  }

  rachaTypeLabel(type: PeladaSummary['type']): string {
    return type === 'TOURNAMENT' ? 'Torneio' : 'Racha comum';
  }

  featuredRachaHeadline(racha: PeladaSummary | null): string {
    if (!racha) {
      return '';
    }

    return 'Este racha fica em destaque até ser concluído pelo ADM.';
  }
}
