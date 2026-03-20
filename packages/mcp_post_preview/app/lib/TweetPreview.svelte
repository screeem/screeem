<script lang="ts">
  import type { TweetData } from "./types";
  import { escapeHtml, formatNumber, tokenizeText } from "./utils";
  import CharCount from "./CharCount.svelte";
  import CopyButton from "./CopyButton.svelte";

  let { tweet }: { tweet: Partial<TweetData> & { text: string } } = $props();

  let displayName = $derived(tweet.displayName ?? "");
  let handle = $derived(tweet.handle ?? "");
  let charCount = $derived(tweet.text.length);
  let isDark = $derived(document.body.classList.contains("dark"));

  let timestamp = $derived(tweet.timestamp || new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }) + " \u00b7 " + new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }));

  let textHtml = $derived(tokenizeText(tweet.text, "tweet-link"));
</script>

<div class="tweet-card">
  <div class="tweet-header">
    <div class="avatar">
      {#if tweet.avatarUrl}
        <img src={escapeHtml(tweet.avatarUrl)} alt="" />
      {:else}
        <svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:#6b7280"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>
      {/if}
    </div>
    <div class="tweet-header-content">
      <div>
        <span class="display-name">{displayName}</span>
        {#if tweet.verified}
          <svg viewBox="0 0 22 22" class="verified-badge"><path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.69-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.636.433 1.221.878 1.69.47.446 1.055.752 1.69.883.635.13 1.294.083 1.902-.144.271.592.706 1.092 1.246 1.448s1.173.552 1.813.568c.646-.016 1.273-.211 1.813-.567s.972-.854 1.246-1.44c.608.222 1.267.272 1.902.14.635-.13 1.22-.436 1.69-.882.445-.47.749-1.055.878-1.69.13-.634.08-1.29-.144-1.897.587-.274 1.087-.705 1.443-1.245.356-.54.555-1.17.574-1.817zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"></path></svg>
        {/if}
      </div>
      <div class="handle">@{handle}</div>
    </div>
    <svg viewBox="0 0 24 24" class="x-logo"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
  </div>

  <div class="tweet-text">{@html textHtml}</div>

  {#if tweet.imageUrl}
    <div class="tweet-image"><img src={escapeHtml(tweet.imageUrl)} alt="" /></div>
  {/if}

  <div class="timestamp">{timestamp}</div>

  {#if tweet.views !== undefined || tweet.retweets !== undefined || tweet.likes !== undefined}
    <div class="divider"></div>
    <div class="metrics">
      {#if tweet.views !== undefined}<span><span class="value">{formatNumber(tweet.views)}</span> Views</span>{/if}
      {#if tweet.retweets !== undefined}<span><span class="value">{formatNumber(tweet.retweets)}</span> Reposts</span>{/if}
      {#if tweet.likes !== undefined}<span><span class="value">{formatNumber(tweet.likes)}</span> Likes</span>{/if}
    </div>
  {/if}

  <div class="divider"></div>

  <div class="actions">
    <button class="action-btn">
      <svg viewBox="0 0 24 24"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.25-.893 4.306-2.394 5.82l-5.72 5.77c-.185.186-.445.293-.707.293-.553 0-1-.447-1-1v-4.011c-3.249-.126-5.7-1.16-7.276-2.718C3.596 12.755 2.75 10.799 2.75 10h-1z"></path></svg>
      {#if tweet.replies !== undefined}<span>{formatNumber(tweet.replies)}</span>{/if}
    </button>
    <button class="action-btn">
      <svg viewBox="0 0 24 24"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></svg>
      {#if tweet.retweets !== undefined}<span>{formatNumber(tweet.retweets)}</span>{/if}
    </button>
    <button class="action-btn">
      <svg viewBox="0 0 24 24"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.965 3.036 4.175 6.127 6.36 3.09-2.185 5.053-4.395 6.127-6.36 1.112-2.04 1.03-3.7.477-4.82-.56-1.13-1.666-1.84-2.907-1.91z"></path></svg>
      {#if tweet.likes !== undefined}<span>{formatNumber(tweet.likes)}</span>{/if}
    </button>
    <button class="action-btn">
      <svg viewBox="0 0 24 24"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z"></path></svg>
    </button>
    <button class="action-btn">
      <svg viewBox="0 0 24 24"><path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"></path></svg>
    </button>
  </div>
</div>

<CharCount count={charCount} limit={280} trackColor={isDark ? "#2f3336" : "#e1e8ed"} />
<CopyButton text={tweet.text} variant="tweet" />

<style>
  .tweet-card {
    max-width: 598px;
    margin: 0 auto;
    border: 1px solid #eff3f4;
    border-radius: 16px;
    padding: 16px;
    background: #fff;
  }
  :global(body.dark) .tweet-card { border-color: #2f3336; background: #000; }

  .tweet-header { display: flex; align-items: flex-start; gap: 12px; }
  .tweet-header-content { flex: 1; min-width: 0; }

  .avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: #e1e8ed; flex-shrink: 0; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }

  .display-name {
    font-weight: 700; font-size: 15px; line-height: 20px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    display: inline;
  }

  .verified-badge {
    display: inline-block; width: 18px; height: 18px;
    vertical-align: middle; margin-left: 2px; fill: #1d9bf0;
  }

  .handle { font-size: 15px; color: #536471; line-height: 20px; }
  :global(body.dark) .handle { color: #71767b; }

  .x-logo { width: 24px; height: 24px; flex-shrink: 0; fill: #0f1419; }
  :global(body.dark) .x-logo { fill: #e7e9ea; }

  .tweet-text {
    margin-top: 12px; font-size: 17px; line-height: 24px;
    white-space: pre-wrap; word-wrap: break-word;
  }

  :global(.tweet-link) { color: #1d9bf0; text-decoration: none; }
  :global(.tweet-link:hover) { text-decoration: underline; }

  .tweet-image {
    margin-top: 12px; border-radius: 16px; overflow: hidden;
    border: 1px solid #eff3f4;
  }
  :global(body.dark) .tweet-image { border-color: #2f3336; }
  .tweet-image img { width: 100%; display: block; max-height: 512px; object-fit: cover; }

  .timestamp { margin-top: 12px; font-size: 13px; color: #536471; }
  :global(body.dark) .timestamp { color: #71767b; }

  .divider { border-top: 1px solid #eff3f4; margin: 12px 0; }
  :global(body.dark) .divider { border-color: #2f3336; }

  .metrics { display: flex; gap: 24px; font-size: 13px; color: #536471; flex-wrap: wrap; }
  :global(body.dark) .metrics { color: #71767b; }
  .metrics :global(.value) { font-weight: 700; color: #0f1419; }
  :global(body.dark) .metrics :global(.value) { color: #e7e9ea; }

  .actions { display: flex; justify-content: space-around; color: #536471; }
  :global(body.dark) .actions { color: #71767b; }
  .action-btn {
    display: flex; align-items: center; gap: 8px;
    background: none; border: none; color: inherit; cursor: pointer;
    padding: 8px; border-radius: 50%; font-size: 13px;
  }
  .action-btn svg { width: 20px; height: 20px; fill: currentColor; }
</style>
