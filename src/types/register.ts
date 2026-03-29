// ═══ PhotoQRbag Register + Badge Types ═══

export interface BadgeConfig {
  enabled: boolean;
  methods: ('line' | 'email' | 'walk-in')[];
  lineChannelId?: string;
  lineChannelSecret?: string;
  lineCallbackUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  collectFields: ('name' | 'phone' | 'email')[];
  luckyDrawEnabled: boolean;
  /** LINE Messaging API token for push notifications */
  lineMessagingToken?: string;
}

export interface BadgeUser {
  id: string;
  eventId: string;
  method: 'line' | 'email' | 'walk-in';
  lineUserId?: string;
  lineDisplayName?: string;
  linePictureUrl?: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  phone?: string;
  personalQrToken: string;
  selfiePath?: string;
  badgePrinted: boolean;
  checkedInAt?: string;
  deviceInfo?: string;
  createdAt: string;
}

export interface SessionBadge {
  id: string;
  sessionId: string;
  badgeToken: string;
  scannedAt: string;
  delivered: boolean;
  deliveredAt?: string;
  notified: boolean;
  retryCount: number;
  lastError?: string;
}

export interface ScanBatch {
  batchId: string;
  boothId: string;
  status: 'open' | 'locked' | 'used' | 'expired';
  badges: string[];
  createdAt: string;
}

export interface LuckyDrawRound {
  id: string;
  eventId: string;
  roundName: string;
  prizeName: string;
  winnerUserId?: string;
  winnerName?: string;
  winnerPicture?: string;
  drawnAt?: string;
  createdAt: string;
}

export interface PersonalPageData {
  user: {
    id: string;
    name?: string;
    picture?: string;
    email?: string;
    method: string;
    checkedInAt?: string;
    personalQrToken: string;
  };
  sessions: {
    sessionId: string;
    photoPath?: string;
    photoQrPath?: string;
    clipPath?: string;
    downloadUrl?: string;
    addedAt: string;
  }[];
  luckyDraw: {
    won: boolean;
    prize?: string;
    round?: string;
  };
}
