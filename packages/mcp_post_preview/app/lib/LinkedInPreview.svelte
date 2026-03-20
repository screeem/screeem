<script lang="ts">
  import type { LinkedInPostData } from "./types";
  import { escapeHtml, formatNumber, tokenizeText } from "./utils";
  import CharCount from "./CharCount.svelte";
  import CopyButton from "./CopyButton.svelte";

  let { post }: { post: Partial<LinkedInPostData> & { text: string } } = $props();

  let authorName = $derived(post.authorName ?? "");
  let charCount = $derived(post.text.length);
  let timestamp = $derived(post.timestamp || "Just now");
  let textHtml = $derived(tokenizeText(post.text, "li-link"));
  let hasReactions = $derived(post.likes !== undefined || post.comments !== undefined || post.reposts !== undefined);
</script>

<div class="li-card">
  <div class="li-header">
    <div class="li-avatar">
      {#if post.authorAvatarUrl}
        <img src={escapeHtml(post.authorAvatarUrl)} alt="" class="li-avatar-img" />
      {:else}
        <svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:#b0b0b0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"></path></svg>
      {/if}
    </div>
    <div class="li-author-info">
      <div class="li-author-name">{authorName}</div>
      {#if post.authorHeadline}
        <div class="li-headline">{post.authorHeadline}</div>
      {/if}
      <div class="li-post-meta">
        <span>{timestamp}</span>
        <span class="li-dot">&middot;</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" class="li-globe-icon"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8A6.5 6.5 0 018 1.5c.47 0 .93.05 1.38.14L7.5 3.5H5L3.06 6.44A6.48 6.48 0 011.5 8zm1.06 2.5L4 8.5h2.5l1 3H5l-2.44-1zm5.94 4a6.5 6.5 0 01-3.44-1.5H6l1-2.5h3l.5 2-2 2zm2.94-1.56L13 11.5h-1.5L10 8.5H12l1.44 1.44c-.23.68-.55 1.33-.94 1.92l-.06.08zm1.56-4.94c0 .68-.1 1.34-.28 1.96L13 10H11L9.5 6.5H12l.94.94c.06.5.09 1 .09 1.5l-.03.5zM10 5.5H8.5l1-2.5c.52.25 1 .58 1.44.96L10 5.5z"/></svg>
      </div>
    </div>
    <button class="li-follow-btn">Follow</button>
  </div>

  <div class="li-text">{@html textHtml}</div>

  {#if post.imageUrl}
    <div class="li-image"><img src={escapeHtml(post.imageUrl)} alt="" /></div>
  {/if}

  {#if hasReactions}
    <div class="li-reactions">
      <div>
        {#if post.likes !== undefined}
          <span class="li-reaction-left">
            <span class="li-reaction-emoji">👍</span>
            <span class="li-reaction-count">{formatNumber(post.likes)}</span>
          </span>
        {/if}
      </div>
      <div class="li-reactions-secondary">
        {#if post.comments !== undefined}{formatNumber(post.comments)} comments{/if}
        {#if post.comments !== undefined && post.reposts !== undefined} &middot; {/if}
        {#if post.reposts !== undefined}{formatNumber(post.reposts)} reposts{/if}
      </div>
    </div>
    <div class="li-divider"></div>
  {/if}

  <div class="li-actions">
    <button class="li-action-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.46 11l-3.91-3.91a7 7 0 01-1.69-2.74l-.49-1.47A2.76 2.76 0 0010.76 1 2.75 2.75 0 008 3.74v1.12a9.19 9.19 0 00.46 2.85L9 9H4.5A2.5 2.5 0 002 11.5a2.6 2.6 0 00.2 1A2.49 2.49 0 002 14a2.65 2.65 0 00.47 1.5 2.5 2.5 0 00.23 3A2.5 2.5 0 005 21h8a7 7 0 006.16-3.71l1.3-2.77A2 2 0 0022 13.4v-1.4a1 1 0 00-1-1zM20 13.4a.17.17 0 010 .06l-1.3 2.77A5 5 0 0113 19H5a.5.5 0 01-.45-.72.49.49 0 00-.05-.42A.49.49 0 004.5 17a.5.5 0 01-.5-.5.52.52 0 01.09-.28.5.5 0 00-.09-.7A.5.5 0 013.5 15a.5.5 0 01-.28-.09.5.5 0 01-.22-.41.52.52 0 01.5-.5H13a1 1 0 001-1 1 1 0 00-.07-.36L13 11H9a7.23 7.23 0 01-.36-2.26V3.74a.75.75 0 01.75-.74.76.76 0 01.74.56l.49 1.47a9 9 0 002.17 3.52L16.7 12H19a1 1 0 011 1z"/></svg>
      Like
    </button>
    <button class="li-action-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 9h10v1H7zm0 4h7v-1H7zm16-2a6.78 6.78 0 01-2.84 5.61L12 22v-4H8A7 7 0 018 4h8a7 7 0 017 7zm-2 0a5 5 0 00-5-5H8a5 5 0 000 10h6v2.28L17.07 15A4.75 4.75 0 0019 11z"/></svg>
      Comment
    </button>
    <button class="li-action-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13.96 5H6a5 5 0 000 10h7v2H6A7 7 0 016 3h7.96zM10 19h8a5 5 0 000-10h-7V7h7a7 7 0 010 14h-8z"/></svg>
      Repost
    </button>
    <button class="li-action-btn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 3L0 10l7.66 4.26L16 8l-6.26 8.34L14 24l7-21z"/></svg>
      Send
    </button>
  </div>
</div>

<CharCount count={charCount} limit={3000} overColor="#cc1016" warnColor="#f5c400" normalColor="#0a66c2" trackColor="#e0dfe2" />
<CopyButton text={post.text} variant="linkedin" />

<style>
  :global(.li-link) { color: #0a66c2; text-decoration: none; font-weight: 600; }
  :global(.li-link:hover) { text-decoration: underline; }
  :global(body.dark .li-link) { color: #70b5f9; }

  .li-card {
    max-width: 555px;
    margin: 0 auto;
    border: 1px solid #e0dfe2;
    border-radius: 8px;
    background: #fff;
    overflow: hidden;
  }
  :global(body.dark) .li-card { background: #1b1f23; border-color: #38434f; }

  .li-header { display: flex; align-items: flex-start; gap: 8px; padding: 12px 16px; }

  .li-avatar {
    width: 48px; height: 48px; border-radius: 50%;
    overflow: hidden; flex-shrink: 0;
    background: #e0dfe2; display: flex; align-items: center; justify-content: center;
  }
  .li-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

  .li-author-info { flex: 1; min-width: 0; }
  .li-author-name {
    font-weight: 600; font-size: 14px; color: rgba(0,0,0,0.9); line-height: 1.4;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  :global(body.dark) .li-author-name { color: rgba(255,255,255,0.9); }
  .li-headline {
    font-size: 12px; color: rgba(0,0,0,0.6); line-height: 1.4;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px;
  }
  :global(body.dark) .li-headline { color: rgba(255,255,255,0.6); }
  .li-post-meta {
    font-size: 12px; color: rgba(0,0,0,0.6); margin-top: 2px;
    display: flex; align-items: center; gap: 4px;
  }
  :global(body.dark) .li-post-meta { color: rgba(255,255,255,0.6); }
  .li-dot { font-size: 10px; }
  .li-globe-icon { width: 12px; height: 12px; fill: rgba(0,0,0,0.6); vertical-align: middle; }
  :global(body.dark) .li-globe-icon { fill: rgba(255,255,255,0.6); }

  .li-follow-btn {
    background: transparent; color: #0a66c2;
    border: 1px solid #0a66c2; padding: 5px 14px;
    border-radius: 20px; font-size: 14px; font-weight: 600;
    cursor: pointer; flex-shrink: 0; white-space: nowrap;
  }
  :global(body.dark) .li-follow-btn { color: #70b5f9; border-color: #70b5f9; }

  .li-text {
    padding: 0 16px 8px; font-size: 14px; line-height: 1.5;
    color: rgba(0,0,0,0.9); word-wrap: break-word; white-space: pre-wrap;
  }
  :global(body.dark) .li-text { color: rgba(255,255,255,0.9); }

  .li-image { overflow: hidden; }
  .li-image img { width: 100%; display: block; max-height: 512px; object-fit: cover; }

  .li-reactions {
    padding: 6px 16px; display: flex; justify-content: space-between;
    align-items: center; color: rgba(0,0,0,0.6); font-size: 13px;
  }
  :global(body.dark) .li-reactions { color: rgba(255,255,255,0.6); }
  .li-reaction-left { display: inline-flex; align-items: center; gap: 3px; }
  .li-reaction-emoji { font-size: 14px; }
  .li-reaction-count { color: rgba(0,0,0,0.6); font-size: 13px; }
  :global(body.dark) .li-reaction-count { color: rgba(255,255,255,0.6); }
  .li-reactions-secondary { font-size: 13px; color: rgba(0,0,0,0.6); }
  :global(body.dark) .li-reactions-secondary { color: rgba(255,255,255,0.6); }

  .li-divider { border-top: 1px solid #e0dfe2; margin: 0 16px; }
  :global(body.dark) .li-divider { border-color: #38434f; }

  .li-actions { display: flex; padding: 2px 8px 4px; }
  .li-action-btn {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: 6px; padding: 10px 8px; border: none; background: none;
    color: rgba(0,0,0,0.6); font-size: 14px; font-weight: 600;
    cursor: pointer; border-radius: 4px;
  }
  :global(body.dark) .li-action-btn { color: rgba(255,255,255,0.6); }
  .li-action-btn svg { width: 18px; height: 18px; fill: currentColor; }
</style>
