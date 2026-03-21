import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from './core/services/auth.service';
import { PushNotificationService } from './core/services/push-notification.service';
import { PlayerNamePipe } from './shared/pipes/player-name.pipe';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    PlayerNamePipe
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    public readonly authService: AuthService,
    private readonly pushNotificationService: PushNotificationService
  ) {
    this.authService.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      void this.pushNotificationService.initForCurrentUser(user);
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
