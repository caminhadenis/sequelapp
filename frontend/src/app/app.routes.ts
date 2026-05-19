import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { homeGuard } from './core/guards/home.guard';
import { LoginComponent } from './pages/login/login.component';
import { PeladaDetailComponent } from './pages/pelada-detail/pelada-detail.component';
import { PeladaListComponent } from './pages/pelada-list/pelada-list.component';
import { PlayerDetailComponent } from './pages/player-detail/player-detail.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { RankingComponent } from './pages/ranking/ranking.component';
import { SignupComponent } from './pages/signup/signup.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [guestGuard]
  },
  {
    path: 'signup',
    component: SignupComponent,
    canActivate: [guestGuard]
  },
  {
    path: 'peladas',
    component: PeladaListComponent,
    canActivate: [authGuard]
  },
  {
    path: 'peladas/:id',
    component: PeladaDetailComponent,
    canActivate: [authGuard]
  },
  {
    path: 'ranking',
    component: RankingComponent,
    canActivate: [authGuard]
  },
  {
    path: 'perfil',
    component: ProfileComponent,
    canActivate: [authGuard]
  },
  {
    path: 'jogadores/:id',
    component: PlayerDetailComponent,
    canActivate: [authGuard]
  },
  {
    path: '',
    pathMatch: 'full',
    component: PeladaListComponent,
    canActivate: [homeGuard]
  },
  {
    path: '**',
    redirectTo: 'peladas'
  }
];
