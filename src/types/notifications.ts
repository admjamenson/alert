export type NotificationType =
  | 'alert'
  | 'sos'
  | 'guardian_request'
  | 'system'
  | string;

export type SosPayload = {
  guardianId?: string;
  guardianName?: string;
  locationLabel?: string;
  coordinate?: [number, number];
  timestamp?: string;
  [key: string]: any;
};

export type GuardianRequestPayload = {
  requesterId?: string;
  requesterName?: string;
  phone?: string;
  [key: string]: any;
};

export type AlertNotification = {
  id: string;
  type: NotificationType;
  title?: string;
  summary?: string;
  message?: string;
  createdAt?: string;
  timestamp?: string;
  data?: Record<string, any>;
  payload?: SosPayload | GuardianRequestPayload | Record<string, any>;
  [key: string]: any;
};
