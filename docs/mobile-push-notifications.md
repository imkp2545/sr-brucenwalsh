# Mobile Push Notifications

This backend supports customer push notifications for Android and iOS through Firebase Cloud Messaging.

## Backend Status

The backend already exposes authenticated customer device registration:

```http
POST /api/v1/notifications/devices
DELETE /api/v1/notifications/devices
GET /api/v1/notifications
```

Campaign notifications create in-app notification records for every targeted customer. If a targeted customer has one or more registered FCM devices and has not disabled push notifications, the backend also sends a device push notification.

## Firebase Backend Configuration

Set these environment variables from a Firebase service account:

```env
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

For iOS, configure APNs inside the same Firebase project. The mobile app still registers an FCM token; Firebase routes it to APNs for iOS.

## Register A Device

Call this after customer login, app launch, and whenever Firebase refreshes the token.

```http
POST /api/v1/notifications/devices
Authorization: Bearer CUSTOMER_ACCESS_TOKEN
Content-Type: application/json

{
  "token": "FCM_TOKEN_FROM_DEVICE",
  "platform": "android",
  "deviceId": "optional-stable-device-id",
  "appVersion": "1.0.0",
  "locale": "en-IN",
  "timezone": "Asia/Kolkata"
}
```

`platform` can be `android`, `ios`, `web`, or `unknown`.

The backend stores both a legacy token list and device metadata, so existing tokens continue to work.

## Remove A Device

Call this during logout, account switch, or when the app intentionally disables push on that device.

```http
DELETE /api/v1/notifications/devices
Authorization: Bearer CUSTOMER_ACCESS_TOKEN
Content-Type: application/json

{
  "token": "FCM_TOKEN_FROM_DEVICE"
}
```

## Customer In-App Inbox

Use this for the notification screen inside the customer app. It works even when device push permission is denied.

```http
GET /api/v1/notifications
Authorization: Bearer CUSTOMER_ACCESS_TOKEN
```

Mark a notification as read:

```http
PATCH /api/v1/notifications/:notificationId/read
Authorization: Bearer CUSTOMER_ACCESS_TOKEN
```

## React Native Example

```js
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';

const API_URL = 'https://your-api-domain.com/api/v1';

export async function registerPushDevice(customerToken) {
  const permission = await messaging().requestPermission();
  const enabled =
    permission === messaging.AuthorizationStatus.AUTHORIZED ||
    permission === messaging.AuthorizationStatus.PROVISIONAL;

  if (!enabled) return null;

  const fcmToken = await messaging().getToken();

  await fetch(`${API_URL}/notifications/devices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${customerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: fcmToken,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: '1.0.0',
      locale: 'en-IN',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });

  return fcmToken;
}

export function listenForTokenRefresh(customerToken) {
  return messaging().onTokenRefresh(async (fcmToken) => {
    await fetch(`${API_URL}/notifications/devices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${customerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: fcmToken, platform: Platform.OS === 'ios' ? 'ios' : 'android' }),
    });
  });
}
```

The customer never sees or enters the FCM token. The app gets it silently after notification permission is allowed.
