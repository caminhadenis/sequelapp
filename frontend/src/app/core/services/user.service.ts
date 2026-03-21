import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  PendingApprovalUser,
  PlayerPosition,
  PositionRankingResponse,
  User
} from '../../models/user';

export interface PushSubscriptionPayload {
  subscription: PushSubscriptionJSON;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private readonly http: HttpClient) {}

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.apiUrl}/users`);
  }

  getPositionRanking(): Observable<PositionRankingResponse> {
    return this.http.get<PositionRankingResponse>(`${this.apiUrl}/users/ranking/by-position`);
  }

  getPendingUsers(): Observable<PendingApprovalUser[]> {
    return this.http.get<PendingApprovalUser[]>(`${this.apiUrl}/users/pending`);
  }

  getMe(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/users/me`);
  }

  approveUser(userId: string): Observable<{ message: string; user: User }> {
    return this.http.patch<{ message: string; user: User }>(`${this.apiUrl}/users/${userId}/approve`, {});
  }

  updateInitialRating(userId: string, initialRating: number): Observable<User> {
    return this.http.patch<User>(`${this.apiUrl}/users/${userId}/initial-rating`, {
      initialRating
    });
  }

  updateMyPosition(position: PlayerPosition): Observable<{ message: string; user: User }> {
    return this.http.patch<{ message: string; user: User }>(`${this.apiUrl}/users/me/position`, {
      position
    });
  }

  updateMyProfile(payload: {
    name: string;
    lastName: string;
    profileImageDataUrl?: string | null;
  }): Observable<{ message: string; user: User }> {
    return this.http.patch<{ message: string; user: User }>(`${this.apiUrl}/users/me/profile`, payload);
  }

  savePushSubscription(payload: PushSubscriptionPayload): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/users/me/push-subscriptions`, payload);
  }

  removePushSubscription(endpoint: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/users/me/push-subscriptions/remove`, {
      endpoint
    });
  }

  broadcastAdminMessage(message: string): Observable<{
    message: string;
    playersCount: number;
    sent: number;
    failed: number;
  }> {
    return this.http.post<{
      message: string;
      playersCount: number;
      sent: number;
      failed: number;
    }>(`${this.apiUrl}/users/notifications/broadcast`, { message });
  }
}
