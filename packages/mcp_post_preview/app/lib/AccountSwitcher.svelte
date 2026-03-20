<script lang="ts">
  import { escapeHtml } from "./utils";

  let { accounts, selectedIndex = 0, onchange }: {
    accounts: Array<{ handle?: string; authorName?: string; accountLabel?: string }>;
    selectedIndex?: number;
    onchange: (index: number) => void;
  } = $props();
</script>

{#if accounts.length > 1}
  <div class="account-switcher">
    <label>Account:</label>
    <select value={selectedIndex} onchange={(e) => onchange(parseInt(e.currentTarget.value, 10))}>
      {#each accounts as account, i}
        {@const handle = account.handle ?? account.authorName ?? "Unknown"}
        {@const label = account.accountLabel ? `${handle} (${account.accountLabel})` : handle}
        <option value={i}>{label}</option>
      {/each}
    </select>
  </div>
{/if}

<style>
  .account-switcher {
    max-width: 598px;
    margin: 0 auto 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .account-switcher label {
    font-size: 13px;
    font-weight: 600;
    color: #536471;
    white-space: nowrap;
  }
  :global(body.dark) .account-switcher label { color: #71767b; }
  .account-switcher select {
    flex: 1;
    padding: 6px 10px;
    font-size: 13px;
    border: 1px solid #cfd9de;
    border-radius: 8px;
    background: #fff;
    color: #0f1419;
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }
  .account-switcher select:focus { border-color: #1d9bf0; }
  :global(body.dark) .account-switcher select {
    background: #000;
    border-color: #2f3336;
    color: #e7e9ea;
  }
</style>
