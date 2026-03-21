import webpush from 'web-push';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

let isConfigured = false;

function ensureConfigured() {
  if (isConfigured) {
    return true;
  }

  if (!env.webPushPublicKey || !env.webPushPrivateKey) {
    return false;
  }

  webpush.setVapidDetails(env.webPushSubject, env.webPushPublicKey, env.webPushPrivateKey);
  isConfigured = true;
  return true;
}

function normalizeSubscription(subscription) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return null;
  }

  return {
    endpoint: String(subscription.endpoint),
    expirationTime:
      typeof subscription.expirationTime === 'number' && Number.isFinite(subscription.expirationTime)
        ? subscription.expirationTime
        : null,
    keys: {
      p256dh: String(subscription.keys.p256dh),
      auth: String(subscription.keys.auth)
    }
  };
}

async function removeInvalidSubscription(userId, endpoint) {
  await User.updateOne(
    { _id: userId },
    {
      $pull: {
        pushSubscriptions: {
          endpoint: String(endpoint)
        }
      }
    }
  );
}

function buildNotificationPayload(input) {
  const url = String(input?.url || '/');

  return JSON.stringify({
    notification: {
      title: String(input?.title || 'Racha Manager'),
      body: String(input?.body || ''),
      icon: '/assets/icons/icon-192x192.png',
      badge: '/assets/icons/icon-192x192.png',
      vibrate: [120, 40, 120],
      data: {
        url,
        onActionClick: {
          default: {
            operation: 'openWindow',
            url
          }
        }
      }
    }
  });
}

export function isWebPushConfigured() {
  return ensureConfigured();
}

export async function sendPushNotificationToUsers(userIds = [], notificationInput) {
  if (!ensureConfigured()) {
    return {
      sent: 0,
      failed: 0,
      skipped: true
    };
  }

  const normalizedUserIds = Array.from(new Set(userIds.map((id) => String(id)).filter(Boolean)));
  if (normalizedUserIds.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: false
    };
  }

  const users = await User.find(
    {
      _id: { $in: normalizedUserIds }
    },
    '_id pushSubscriptions'
  ).lean();

  const payload = buildNotificationPayload(notificationInput);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    users.flatMap((user) =>
      (user.pushSubscriptions || []).map(async (subscription) => {
        const normalizedSubscription = normalizeSubscription(subscription);
        if (!normalizedSubscription) {
          failed += 1;
          return;
        }

        try {
          await webpush.sendNotification(normalizedSubscription, payload);
          sent += 1;
        } catch (error) {
          failed += 1;
          const statusCode = Number(error?.statusCode || error?.status || 0);
          if (statusCode === 404 || statusCode === 410) {
            await removeInvalidSubscription(user._id, normalizedSubscription.endpoint);
          }
        }
      })
    )
  );

  return {
    sent,
    failed,
    skipped: false
  };
}
