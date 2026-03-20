export interface TweetData {
  displayName: string;
  handle: string;
  text: string;
  avatarUrl?: string;
  imageUrl?: string;
  verified?: boolean;
  timestamp?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  views?: number;
}

export interface LinkedInPostData {
  authorName: string;
  authorHeadline?: string;
  authorAvatarUrl?: string;
  text: string;
  imageUrl?: string;
  timestamp?: string;
  likes?: number;
  comments?: number;
  reposts?: number;
}

export interface AccountData extends Record<string, unknown> {
  _type?: string;
  text: string;
  handle?: string;
  authorName?: string;
  accountLabel?: string;
  accountId?: string;
}
