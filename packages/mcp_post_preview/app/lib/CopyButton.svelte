<script lang="ts">
  let { text, variant = "tweet" }: { text: string; variant?: "tweet" | "linkedin" } = $props();
  let label = $state("Copy post");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    label = "Copied!";
    setTimeout(() => { label = "Copy post"; }, 2000);
  }
</script>

<button class={variant === "linkedin" ? "li-copy-btn" : "copy-btn"} onclick={handleCopy}>
  {label}
</button>

<style>
  .copy-btn {
    display: block;
    margin: 12px auto 0;
    padding: 7px 20px;
    background: none;
    border: 1px solid #cfd9de;
    border-radius: 20px;
    color: #536471;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .copy-btn:hover { background: rgba(83,100,113,0.1); }
  :global(body.dark) .copy-btn { border-color: #2f3336; color: #71767b; }
  :global(body.dark) .copy-btn:hover { background: rgba(113,118,123,0.1); }

  .li-copy-btn {
    display: block;
    margin: 12px auto 0;
    padding: 7px 20px;
    background: none;
    border: 1px solid #c0c0c0;
    border-radius: 20px;
    color: rgba(0,0,0,0.6);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .li-copy-btn:hover { background: rgba(0,0,0,0.05); }
  :global(body.dark) .li-copy-btn { border-color: #38434f; color: rgba(255,255,255,0.6); }
  :global(body.dark) .li-copy-btn:hover { background: rgba(255,255,255,0.05); }
</style>
