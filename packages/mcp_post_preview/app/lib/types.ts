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

export interface CalendarPost {
  id: string;
  title: string;
  copy: string;
  date: string;
  time: string;
  targets: string[];
  tags: string[];
  revision: number;
  approval: {
    status: "draft" | "in_review" | "changes_requested" | "approved";
    reviewRevision: number | null;
    requestedBy: string | null;
    comment: string;
  };
}

export interface CalendarData extends Record<string, unknown> {
  _type: "calendar";
  operation: "list" | "create" | "update" | "reschedule" | "remove";
  posts: CalendarPost[];
  changedPostId?: string;
}
