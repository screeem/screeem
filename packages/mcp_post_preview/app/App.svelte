<script lang="ts">
  import { onMount } from "svelte";
  import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
  import type { TweetData, LinkedInPostData, AccountData } from "./lib/types";
  import AccountSwitcher from "./lib/AccountSwitcher.svelte";
  import TweetPreview from "./lib/TweetPreview.svelte";
  import LinkedInPreview from "./lib/LinkedInPreview.svelte";

  let { app }: { app: McpApp } = $props();

  let postData: Record<string, unknown> | null = $state(null);
  let accounts: AccountData[] = $state([]);
  let selectedIndex = $state(0);

  let currentAccount = $derived(accounts[selectedIndex] ?? accounts[0]);
  let isLinkedin = $derived(
    postData?._type === "linkedin" || currentAccount?._type === "linkedin"
  );

  function applyTheme(theme: string | undefined) {
    if (theme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }

  onMount(() => {
    app.ontoolresult = (params: { content?: Array<{ type: string; text?: string }> }) => {
      const text = params.content?.find((c) => c.type === "text") as { type: string; text: string } | undefined;
      if (!text?.text) return;

      try {
        const data = JSON.parse(text.text) as Record<string, unknown>;
        postData = data;
        accounts = (data.accounts as AccountData[]) ?? [data as unknown as AccountData];
        selectedIndex = 0;
      } catch {
        postData = null;
        accounts = [];
      }
    };

    app.onhostcontextchanged = (params: { theme?: string }) => {
      if (params.theme) applyTheme(params.theme);
    };

    const ctx = app.getHostContext();
    if (ctx?.theme) applyTheme(ctx.theme as string);
  });
</script>

{#if currentAccount}
  <AccountSwitcher
    accounts={accounts}
    {selectedIndex}
    onchange={(i) => selectedIndex = i}
  />

  {#if isLinkedin}
    <LinkedInPreview post={currentAccount as unknown as LinkedInPostData} />
  {:else}
    <TweetPreview tweet={currentAccount as unknown as TweetData} />
  {/if}
{:else}
  <div class="empty-state">
    <h2>Waiting for post...</h2>
    <p>Use <code>create_or_update_post</code> to get started.</p>
  </div>
{/if}

<style>
  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #536471;
  }
  :global(body.dark) .empty-state { color: #71767b; }
  .empty-state h2 { font-size: 20px; margin-bottom: 8px; color: #9ca3af; }
  :global(body.dark) .empty-state h2 { color: #6b7280; }
</style>
