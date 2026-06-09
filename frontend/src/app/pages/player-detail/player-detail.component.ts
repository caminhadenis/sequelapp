import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';
import { PlayerPosition, PlayerStamina, User } from '../../models/user';

@Component({
  selector: 'app-player-detail',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressBarModule,
    PlayerNamePipe
  ],
  templateUrl: './player-detail.component.html',
  styleUrls: ['./player-detail.component.scss']
})
export class PlayerDetailComponent implements OnInit {
  loading = false;
  saving = false;
  ratingSaving = false;
  playerId = '';
  player: User | null = null;

  readonly positionOptions: Array<{ value: PlayerPosition; label: string }> = [
    { value: 'ZAGUEIRO', label: 'Zagueiro' },
    { value: 'MEIA', label: 'Meia' },
    { value: 'ATACANTE', label: 'Atacante' }
  ];

  readonly staminaOptions: Array<{ value: PlayerStamina; label: string }> = [
    { value: 'BAIXA', label: 'Baixa' },
    { value: 'MEDIA', label: 'Média' },
    { value: 'ALTA', label: 'Alta' }
  ];

  readonly fieldProfileForm = this.formBuilder.group({
    position: ['', Validators.required],
    stamina: ['MEDIA', Validators.required]
  });

  readonly ratingOptions = Array.from({ length: 10 }, (_, index) => Number(((index + 1) * 0.5).toFixed(1)));

  readonly globalRatingForm = this.formBuilder.group({
    ratingAverage: [3, [Validators.required, Validators.min(0.5), Validators.max(5)]]
  });

  constructor(
    private readonly route: ActivatedRoute,
    private readonly formBuilder: FormBuilder,
    private readonly userService: UserService,
    private readonly snackBar: MatSnackBar,
    public readonly authService: AuthService
  ) {}

  ngOnInit(): void {
    this.playerId = String(this.route.snapshot.paramMap.get('id') || '');
    if (!this.playerId || !this.authService.isAdmin) {
      return;
    }

    this.loadPlayer();
  }

  loadPlayer(): void {
    if (!this.playerId || !this.authService.isAdmin) {
      return;
    }

    this.loading = true;
    this.userService.getUserById(this.playerId).subscribe({
      next: (user) => {
        this.player = user;
        this.fieldProfileForm.patchValue(
          {
            position: user.position || '',
            stamina: user.stamina || 'MEDIA'
          },
          { emitEvent: false }
        );
        this.globalRatingForm.patchValue(
          {
            ratingAverage: Number(user.ratingAverage || 3)
          },
          { emitEvent: false }
        );
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao carregar jogador.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  saveFieldProfile(): void {
    if (!this.authService.isAdmin || !this.playerId || this.fieldProfileForm.invalid || this.saving) {
      this.fieldProfileForm.markAllAsTouched();
      return;
    }

    const { position, stamina } = this.fieldProfileForm.getRawValue();
    if (!position || !stamina) {
      return;
    }

    this.saving = true;
    this.userService
      .adminUpdatePlayerFieldProfile(this.playerId, {
        position: position as PlayerPosition,
        stamina: stamina as PlayerStamina
      })
      .subscribe({
        next: (response) => {
          this.saving = false;
          this.player = response.user;
          this.fieldProfileForm.patchValue(
            {
              position: response.user.position || '',
              stamina: response.user.stamina || 'MEDIA'
            },
            { emitEvent: false }
          );
          this.snackBar.open(response.message || 'Perfil em campo atualizado.', 'Fechar', {
            duration: 2600
          });
        },
        error: (error) => {
          this.saving = false;
          this.snackBar.open(error?.error?.message || 'Falha ao atualizar perfil em campo.', 'Fechar', {
            duration: 3000
          });
        }
      });
  }

  saveGlobalRating(): void {
    if (!this.authService.isAdmin || !this.playerId || this.globalRatingForm.invalid || this.ratingSaving) {
      this.globalRatingForm.markAllAsTouched();
      return;
    }

    const { ratingAverage } = this.globalRatingForm.getRawValue();
    const normalizedRating = Number(ratingAverage);
    if (!Number.isFinite(normalizedRating)) {
      return;
    }

    this.ratingSaving = true;
    this.userService.updateGlobalRating(this.playerId, normalizedRating).subscribe({
      next: (response) => {
        this.ratingSaving = false;
        this.player = response.user;
        this.globalRatingForm.patchValue(
          {
            ratingAverage: Number(response.user.ratingAverage || normalizedRating)
          },
          { emitEvent: false }
        );
        this.snackBar.open(response.message || 'Nota global atualizada.', 'Fechar', {
          duration: 2600
        });
      },
      error: (error) => {
        this.ratingSaving = false;
        this.snackBar.open(error?.error?.message || 'Falha ao atualizar nota global.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }
}
