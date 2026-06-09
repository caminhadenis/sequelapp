import mongoose from 'mongoose';

const voteSchema = new mongoose.Schema(
  {
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    score: {
      type: Number,
      min: 0.5,
      max: 5,
      validate: {
        validator: (value) => Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9,
        message: 'Score must be in 0.5 increments between 0.5 and 5.0.'
      },
      required: true
    }
  },
  {
    timestamps: true
  }
);

const craqueVoteSchema = new mongoose.Schema(
  {
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    firstUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    secondUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    thirdUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  {
    timestamps: true
  }
);

const craqueResultItemSchema = new mongoose.Schema(
  {
    position: {
      type: Number,
      min: 1,
      max: 3,
      required: true
    },
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    points: {
      type: Number,
      default: 0
    },
    firstPlaces: {
      type: Number,
      default: 0
    },
    secondPlaces: {
      type: Number,
      default: 0
    },
    thirdPlaces: {
      type: Number,
      default: 0
    }
  },
  {
    _id: false
  }
);

const craqueResultSchema = new mongoose.Schema(
  {
    totalBallots: {
      type: Number,
      default: 0
    },
    top3: [craqueResultItemSchema]
  },
  {
    _id: false
  }
);

const playerStatSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    goals: {
      type: Number,
      default: 0,
      min: 0
    },
    assists: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    _id: false
  }
);

const presenceEntrySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    markedAt: {
      type: Date,
      required: true,
      default: Date.now
    }
  },
  {
    _id: true
  }
);

const tournamentMatchSchema = new mongoose.Schema(
  {
    homeTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    awayTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    round: {
      type: Number,
      required: true
    },
    homeGoals: {
      type: Number,
      min: 0,
      default: null
    },
    awayGoals: {
      type: Number,
      min: 0,
      default: null
    }
  },
  {
    _id: true
  }
);

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      }
    ],
    guestPlayers: [
      {
        name: {
          type: String,
          required: true,
          trim: true
        },
        position: {
          type: String,
          enum: ['ZAGUEIRO', 'MEIA', 'ATACANTE'],
          required: true
        }
      }
    ],
    goalkeepers: [
      {
        type: String,
        trim: true
      }
    ],
    wins: {
      type: Number,
      default: 0,
      min: 0
    },
    draws: {
      type: Number,
      default: 0,
      min: 0
    },
    losses: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  {
    timestamps: false
  }
);

const drawDraftGuestPlayerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    position: {
      type: String,
      enum: ['ZAGUEIRO', 'MEIA', 'ATACANTE'],
      default: null
    },
    stamina: {
      type: String,
      enum: ['BAIXA', 'MEDIA', 'ALTA'],
      default: 'MEDIA',
      required: true
    }
  },
  {
    _id: false
  }
);

const drawDraftSchema = new mongoose.Schema(
  {
    teamCount: {
      type: Number,
      min: 2,
      max: 4,
      default: 4,
      required: true
    },
    playerIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    guestPlayers: [drawDraftGuestPlayerSchema],
    updatedAt: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  {
    _id: false
  }
);

const peladaSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: ['NORMAL', 'TOURNAMENT'],
      default: 'NORMAL',
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    teams: [teamSchema],
    tournamentMatches: [tournamentMatchSchema],
    playerStats: [playerStatSchema],
    presenceOpenAt: {
      type: Date,
      default: null
    },
    presenceEntries: [presenceEntrySchema],
    votingStatus: {
      type: String,
      enum: ['CLOSED', 'OPEN', 'FINISHED'],
      default: 'CLOSED',
      required: true
    },
    status: {
      type: String,
      enum: ['OPEN', 'CONCLUDED'],
      default: 'OPEN',
      required: true
    },
    votes: [voteSchema],
    craqueVotes: [craqueVoteSchema],
    craqueResult: {
      type: craqueResultSchema,
      default: null
    },
    drawDraft: {
      type: drawDraftSchema,
      default: null
    }
  },
  {
    timestamps: true
  }
);

peladaSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

export const Pelada = mongoose.model('Pelada', peladaSchema);
