import { Injectable } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { User } from '../../models/user';
import { UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly webPushPublicKey = String(environment.webPushPublicKey || '').trim();
  private initializedUserId: string | null = null;

  constructor(
    private readonly swPush: SwPush,
    private readonly userService: UserService
  ) {}

  async initForCurrentUser(user: User | null): Promise<void> {
    if (!user || user.role !== 'JOGADOR') {
      this.initializedUserId = null;
      return;
    }

    if (!this.swPush.isEnabled || !this.webPushPublicKey) {
      return;
    }

    if (this.initializedUserId === user.id) {
      return;
    }

    if (typeof Notification === 'undefined') {
      return;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return;
    }

    try {
      let subscription = await firstValueFrom(this.swPush.subscription);
      if (!subscription) {
        subscription = await this.swPush.requestSubscription({
          serverPublicKey: this.webPushPublicKey
        });
      }

      await firstValueFrom(
        this.userService.savePushSubscription({
          subscription: subscription.toJSON()
        })
      );

      this.initializedUserId = user.id;
    } catch {
      // Falhas de push nao devem interromper o uso normal do app.
    }
  }
}
