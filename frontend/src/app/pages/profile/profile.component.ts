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
import { AuthService } from '../../core/services/auth.service';
import { UserService } from '../../core/services/user.service';
import { PlayerPosition, PlayerStamina, User } from '../../models/user';
import { PlayerNamePipe } from '../../shared/pipes/player-name.pipe';
import { toAbsoluteProfileImageUrl } from '../../shared/utils/profile-image';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSnackBarModule,
    MatProgressBarModule,
    PlayerNamePipe
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  loading = false;
  profileLoading = false;
  positionLoading = false;
  currentUser: User | null = null;
  profileImagePreviewUrl: string | null = null;

  readonly playerPositionOptions: Array<{ value: PlayerPosition; label: string }> = [
    { value: 'ZAGUEIRO', label: 'Zagueiro' },
    { value: 'MEIA', label: 'Meia' },
    { value: 'ATACANTE', label: 'Atacante' }
  ];
  readonly playerStaminaOptions: Array<{ value: PlayerStamina; label: string }> = [
    { value: 'BAIXA', label: 'Baixa' },
    { value: 'MEDIA', label: 'Média' },
    { value: 'ALTA', label: 'Alta' }
  ];

  private profileImageDataUrl: string | null | undefined;
  private readonly profileImageMaxBytes = 2 * 1024 * 1024;

  readonly profileForm = this.formBuilder.group({
    name: ['', Validators.required],
    lastName: ['', Validators.required]
  });

  readonly positionForm = this.formBuilder.group({
    position: ['', Validators.required],
    stamina: ['MEDIA', Validators.required]
  });

  constructor(
    public readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly formBuilder: FormBuilder,
    private readonly snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    if (this.authService.isAdmin) {
      return;
    }

    this.loadProfile();
  }

  get isPlayer(): boolean {
    return this.authService.currentUser?.role === 'JOGADOR';
  }

  loadProfile(): void {
    this.loading = true;
    this.userService.getMe().subscribe({
      next: (user) => {
        this.applyUser(user);
        this.authService.syncCurrentUser(user);
        this.loading = false;
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(error?.error?.message || 'Falha ao carregar perfil.', 'Fechar', {
          duration: 3000
        });
      }
    });
  }

  async onProfileImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.snackBar.open('Formato inválido. Use JPG, PNG ou WEBP.', 'Fechar', { duration: 3000 });
      if (input) input.value = '';
      return;
    }

    if (file.size > this.profileImageMaxBytes) {
      this.snackBar.open('A imagem deve ter no máximo 2MB.', 'Fechar', { duration: 3000 });
      if (input) input.value = '';
      return;
    }

    try {
      const dataUrl = await this.readFileAsDataUrl(file);
      this.profileImageDataUrl = dataUrl;
      this.profileImagePreviewUrl = dataUrl;
    } catch {
      this.snackBar.open('Não foi possível ler a imagem selecionada.', 'Fechar', { duration: 3000 });
    } finally {
      if (input) input.value = '';
    }
  }

  clearProfileImage(): void {
    this.profileImageDataUrl = null;
    this.profileImagePreviewUrl = null;
  }

  hasProfileImage(): boolean {
    return Boolean(this.profileImagePreviewUrl);
  }

  saveProfile(): void {
    if (!this.isPlayer || this.profileForm.invalid || this.profileLoading || this.loading) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const { name, lastName } = this.profileForm.getRawValue();
    if (!name || !lastName) {
      return;
    }

    this.profileLoading = true;
    this.userService
      .updateMyProfile({
        name: String(name).trim(),
        lastName: String(lastName).trim(),
        ...(this.profileImageDataUrl !== undefined ? { profileImageDataUrl: this.profileImageDataUrl } : {})
      })
      .subscribe({
        next: (response) => {
          this.profileLoading = false;
          this.profileImageDataUrl = undefined;
          this.applyUser(response.user);
          this.authService.syncCurrentUser(response.user);
          this.snackBar.open(response.message || 'Perfil atualizado com sucesso.', 'Fechar', {
            duration: 2600
          });
        },
        error: (error) => {
          this.profileLoading = false;
          this.snackBar.open(error?.error?.message || 'Falha ao atualizar perfil.', 'Fechar', {
            duration: 3000
          });
        }
      });
  }

  savePosition(): void {
    if (!this.isPlayer || this.positionForm.invalid || this.positionLoading || this.loading) {
      this.positionForm.markAllAsTouched();
      return;
    }

    const { position, stamina } = this.positionForm.getRawValue();
    if (!position || !stamina) {
      return;
    }

    this.positionLoading = true;
    this.userService
      .updateMyFieldProfile({
        position: position as PlayerPosition,
        stamina: stamina as PlayerStamina
      })
      .subscribe({
        next: (response) => {
          this.positionLoading = false;
          this.applyUser(response.user);
          this.authService.syncCurrentUser(response.user);
          this.snackBar.open(response.message || 'Perfil em campo atualizado com sucesso.', 'Fechar', {
            duration: 2600
          });
        },
        error: (error) => {
          this.positionLoading = false;
          this.snackBar.open(error?.error?.message || 'Falha ao atualizar perfil em campo.', 'Fechar', {
            duration: 3000
          });
        }
      });
  }

  playerPositionLabel(position?: PlayerPosition): string {
    if (position === 'ZAGUEIRO') return 'Zagueiro';
    if (position === 'MEIA') return 'Meia';
    if (position === 'ATACANTE') return 'Atacante';
    return 'Não definida';
  }

  playerStaminaLabel(stamina?: PlayerStamina): string {
    if (stamina === 'BAIXA') return 'Baixa';
    if (stamina === 'MEDIA') return 'Média';
    if (stamina === 'ALTA') return 'Alta';
    return 'Média';
  }

  totalMatches(summary: User | null): number {
    if (!summary) {
      return 0;
    }

    return Number(summary.totalWins || 0) + Number(summary.totalDraws || 0) + Number(summary.totalLosses || 0);
  }

  totalTop3Appearances(summary: User | null): number {
    if (!summary) {
      return 0;
    }

    return (
      Number(summary.totalCraqueFirstPlaces || 0) +
      Number(summary.totalCraqueSecondPlaces || 0) +
      Number(summary.totalCraqueThirdPlaces || 0)
    );
  }

  private applyUser(user: User): void {
    this.currentUser = user;

    const { name, lastName } = this.splitUserName(user.name);
    this.profileForm.patchValue(
      {
        name,
        lastName
      },
      { emitEvent: false }
    );

    this.positionForm.patchValue(
      {
        position: user.position || '',
        stamina: user.stamina || 'MEDIA'
      },
      { emitEvent: false }
    );

    this.profileImageDataUrl = undefined;
    this.profileImagePreviewUrl = toAbsoluteProfileImageUrl(user.profileImageUrl);
  }

  private splitUserName(fullName?: string): { name: string; lastName: string } {
    const normalized = String(fullName || '')
      .trim()
      .replace(/\s+/g, ' ');

    if (!normalized) {
      return { name: '', lastName: '' };
    }

    const parts = normalized.split(' ');
    if (parts.length === 1) {
      return { name: parts[0], lastName: '' };
    }

    return {
      name: parts[0],
      lastName: parts.slice(1).join(' ')
    };
  }

  private async readFileAsDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Leitura de arquivo inválida.'));
      };
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
      reader.readAsDataURL(file);
    });
  }

}
