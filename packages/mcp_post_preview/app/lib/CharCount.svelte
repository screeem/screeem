<script lang="ts">
  let { count, limit, overColor = "#f4212e", warnColor = "#ffd400", normalColor = "#1d9bf0", trackColor = "#e1e8ed" }: {
    count: number;
    limit: number;
    overColor?: string;
    warnColor?: string;
    normalColor?: string;
    trackColor?: string;
  } = $props();

  const circumference = 2 * Math.PI * 14;
  let isOverLimit = $derived(count > limit);
  let charPercent = $derived(Math.min((count / limit) * 100, 100));
  let strokeColor = $derived(isOverLimit ? overColor : charPercent > 90 ? warnColor : normalColor);
  let offset = $derived(circumference * (1 - charPercent / 100));
</script>

<div class="char-count" class:over-limit={isOverLimit}>
  <svg width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5" stroke={trackColor}></circle>
    <circle cx="16" cy="16" r="14" fill="none" stroke-width="2.5"
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      stroke-linecap="round"
      transform="rotate(-90 16 16)"
      stroke={strokeColor}>
    </circle>
  </svg>
  <span>{count} / {limit}{isOverLimit ? " (over limit!)" : ""}</span>
</div>

<style>
  .char-count {
    margin-top: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 14px;
    color: #536471;
  }
  :global(body.dark) .char-count { color: #71767b; }
  .char-count.over-limit { color: #f4212e; }
</style>
