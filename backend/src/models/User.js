import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    endpoint: {
      type: String,
      required: true,
      trim: true
    },
    expirationTime: {
      type: Number,
      default: null
    },
    keys: {
      p256dh: {
        type: String,
        required: true
      },
      auth: {
        type: String,
        required: true
      }
    },
    userAgent: {
      type: String,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    _id: false
  }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['ADM', 'JOGADOR'],
      default: 'JOGADOR',
      required: true
    },
    profileImageUrl: {
      type: String,
      trim: true
    },
    position: {
      type: String,
      enum: ['ZAGUEIRO', 'MEIA', 'ATACANTE']
    },
    stamina: {
      type: String,
      enum: ['BAIXA', 'MEDIA', 'ALTA'],
      default: 'MEDIA'
    },
    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED'],
      default: 'APPROVED',
      required: true
    },
    initialRating: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
      required: true
    },
    ratingAverage: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
      required: true
    },
    totalGoals: {
      type: Number,
      default: 0
    },
    totalAssists: {
      type: Number,
      default: 0
    },
    totalWins: {
      type: Number,
      default: 0
    },
    totalDraws: {
      type: Number,
      default: 0
    },
    totalLosses: {
      type: Number,
      default: 0
    },
    totalCraquePoints: {
      type: Number,
      default: 0
    },
    totalCraqueFirstPlaces: {
      type: Number,
      default: 0
    },
    totalCraqueSecondPlaces: {
      type: Number,
      default: 0
    },
    totalCraqueThirdPlaces: {
      type: Number,
      default: 0
    },
    totalTournamentTitles: {
      type: Number,
      default: 0
    },
    refreshTokenHash: {
      type: String
    },
    refreshTokenExpiresAt: {
      type: Date
    },
    pushSubscriptions: [pushSubscriptionSchema]
  },
  {
    timestamps: true
  }
);

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.refreshTokenHash;
    delete ret.refreshTokenExpiresAt;
    delete ret.pushSubscriptions;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);
