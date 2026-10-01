export type CallitProfile = {
  id: string;
  privy_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  website: string | null;
  x_handle: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  wallet_address: string | null;
  created_at?: string;
};

export type CallitNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};
