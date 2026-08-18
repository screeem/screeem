<script lang="ts">
  import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
  import type { CalendarData, CalendarPost } from "./types";

  let { app, data }: { app: McpApp; data: CalendarData } = $props();

  const targetOptions = ["X", "LinkedIn", "Instagram"] as const;
  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const monthFormatter = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

  let posts = $state<CalendarPost[]>([]);
  let cursor = $state(new Date());
  let mode = $state<"new" | "edit" | null>(null);
  let selectedId = $state<string | null>(null);
  let initialized = $state(false);
  let confirmingRemove = $state(false);
  let busy = $state(false);
  let error = $state("");
  let title = $state("");
  let copy = $state("");
  let date = $state("");
  let time = $state("09:00");
  let targets = $state<string[]>(["X"]);
  let tags = $state("");

  let monthLabel = $derived(monthFormatter.format(cursor));
  let cells = $derived(buildMonth(cursor));
  let selectedPost = $derived(posts.find((post) => post.id === selectedId) ?? null);

  $effect(() => {
    posts = data.posts ?? [];
    if (!initialized) {
      const firstPost = posts[0];
      if (firstPost) cursor = new Date(`${firstPost.date}T00:00:00Z`);
      initialized = true;
    }
  });

  function isoDate(value: Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  function buildMonth(value: Date) {
    const year = value.getUTCFullYear();
    const month = value.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      return day < 1 || day > days ? null : { day, date: isoDate(new Date(Date.UTC(year, month, day))) };
    });
  }

  function shiftMonth(amount: number) {
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + amount, 1));
  }

  function resetForm(post?: CalendarPost, scheduledDate?: string) {
    selectedId = post?.id ?? null;
    title = post?.title ?? "";
    copy = post?.copy ?? "";
    date = post?.date ?? scheduledDate ?? isoDate(new Date());
    time = post?.time ?? "09:00";
    targets = post ? [...post.targets] : ["X"];
    tags = post?.tags.join(", ") ?? "";
    confirmingRemove = false;
    error = "";
    mode = post ? "edit" : "new";
  }

  function toggleTarget(target: string) {
    targets = targets.includes(target)
      ? targets.filter((candidate) => candidate !== target)
      : [...targets, target];
  }

  function parseResult(result: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string }>;
  }) {
    if (result.isError) {
      throw new Error(result.content?.find((item) => item.type === "text")?.text ?? "Calendar operation failed");
    }
    const structured = result.structuredContent;
    if (structured?._type === "calendar" && Array.isArray(structured.posts)) {
      return structured as unknown as CalendarData;
    }
    const text = result.content?.find((item) => item.type === "text")?.text;
    const parsed = text ? JSON.parse(text) as CalendarData : null;
    if (!parsed || parsed._type !== "calendar") throw new Error("The calendar returned an invalid response");
    return parsed;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    busy = true;
    error = "";
    try {
      const result = await app.callServerTool({ name, arguments: args });
      const next = parseResult(result);
      posts = next.posts;
      return true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Calendar operation failed";
      return false;
    } finally {
      busy = false;
    }
  }

  async function save() {
    const nextTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (!title.trim() || !date || !time || targets.length === 0) {
      error = "Add a title, schedule, and at least one social network.";
      return;
    }
    const args = { title: title.trim(), copy, date, time, targets, tags: nextTags };
    const saved = selectedPost
      ? await callTool("update_scheduled_post", {
          post_id: selectedPost.id,
          expected_revision: selectedPost.revision,
          ...args,
        })
      : await callTool("schedule_post", args);
    if (saved) mode = null;
  }

  async function remove() {
    if (!selectedPost) return;
    if (!confirmingRemove) {
      confirmingRemove = true;
      return;
    }
    const removed = await callTool("remove_scheduled_post", {
      post_id: selectedPost.id,
      expected_revision: selectedPost.revision,
    });
    if (removed) mode = null;
  }

  async function move(post: CalendarPost, amount: number) {
    const next = new Date(`${post.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + amount);
    await callTool("reschedule_post", {
      post_id: post.id,
      expected_revision: post.revision,
      date: isoDate(next),
      time: post.time,
    });
  }
</script>

<div class="calendar-app">
  <header>
    <div>
      <p class="eyebrow">Screeem publishing workspace</p>
      <h1>Content calendar</h1>
      <p class="subtitle">Manage the same append-only schedule available to your MCP agent.</p>
    </div>
    <button class="primary" onclick={() => resetForm()}>+ Schedule post</button>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="toolbar">
    <div class="month-nav">
      <button aria-label="Previous month" onclick={() => shiftMonth(-1)}>‹</button>
      <button aria-label="Next month" onclick={() => shiftMonth(1)}>›</button>
      <strong>{monthLabel}</strong>
    </div>
    <span>{posts.length} active {posts.length === 1 ? "post" : "posts"}</span>
  </div>

  <div class="calendar">
    {#each weekdays as weekday}<div class="weekday">{weekday}</div>{/each}
    {#each cells as cell}
      <div class:empty={!cell} class="day">
        {#if cell}
          <button class="day-number" aria-label={`Schedule a post on ${cell.date}`} onclick={() => resetForm(undefined, cell.date)}>{cell.day}</button>
          {#each posts.filter((post) => post.date === cell.date) as post (post.id)}
            <article class="post-card">
              <button class="post-title" onclick={() => resetForm(post)}>{post.title}</button>
              {#if post.tags.length}<p class="tags">{post.tags.map((tag) => `#${tag}`).join(" ")}</p>{/if}
              <div class="post-meta"><span>{post.time} · {post.approval.status.replaceAll("_", " ")}</span><span>{post.targets.join(" · ")}</span></div>
              <div class="move-actions">
                <button aria-label={`Move ${post.title} one day earlier`} disabled={busy} onclick={() => move(post, -1)}>← 1d</button>
                <button aria-label={`Move ${post.title} one day later`} disabled={busy} onclick={() => move(post, 1)}>1d →</button>
              </div>
            </article>
          {/each}
        {/if}
      </div>
    {/each}
  </div>

  {#if mode}
    <div class="overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && (mode = null)}>
      <section class="editor" aria-label={mode === "new" ? "Schedule a post" : "Edit scheduled post"}>
        <div class="editor-heading">
          <div><p class="eyebrow">{mode === "new" ? "New calendar entry" : `Revision ${selectedPost?.revision}`}</p><h2>{mode === "new" ? "Schedule a post" : "Edit post"}</h2></div>
          <button class="close" aria-label="Close editor" onclick={() => mode = null}>×</button>
        </div>
        <label>Title<input bind:value={title} maxlength="160" /></label>
        <label>Post copy<textarea bind:value={copy} rows="5" maxlength="10000"></textarea></label>
        <div class="schedule-fields"><label>Date<input bind:value={date} type="date" /></label><label>Time<input bind:value={time} type="time" /></label></div>
        <fieldset><legend>Publish to</legend><div class="choices">{#each targetOptions as target}<button class:active={targets.includes(target)} onclick={() => toggleTarget(target)} type="button">{target}</button>{/each}</div></fieldset>
        <label>Tags <span>(comma-separated)</span><input bind:value={tags} placeholder="campaign, launch" /></label>
        <div class="editor-actions">
          {#if mode === "edit"}<button class="danger" disabled={busy} onclick={remove}>{confirmingRemove ? "Confirm remove" : "Remove"}</button>{/if}
          <span></span>
          <button class="secondary" onclick={() => mode = null}>Cancel</button>
          <button class="primary" disabled={busy} onclick={save}>{busy ? "Saving…" : mode === "new" ? "Schedule" : "Save changes"}</button>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  :global(*) { box-sizing: border-box; }
  .calendar-app { color: #172033; min-width: 680px; }
  header, .toolbar, .month-nav, .post-meta, .move-actions, .editor-heading, .editor-actions { display: flex; align-items: center; }
  header { justify-content: space-between; gap: 24px; margin-bottom: 20px; }
  h1, h2, p { margin: 0; }
  h1 { margin-top: 3px; font-size: 25px; letter-spacing: -.03em; }
  h2 { margin-top: 3px; font-size: 21px; }
  .eyebrow { color: #7655d8; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
  .subtitle { margin-top: 6px; color: #68748a; font-size: 12px; }
  button, input, textarea { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: wait; opacity: .5; }
  .primary { border: 0; border-radius: 9px; background: #7655d8; color: white; padding: 9px 13px; font-size: 12px; font-weight: 700; }
  .toolbar { justify-content: space-between; border: 1px solid #dce1e9; border-bottom: 0; border-radius: 13px 13px 0 0; padding: 10px 12px; color: #68748a; font-size: 11px; }
  .month-nav { gap: 7px; }
  .month-nav button, .close { border: 1px solid #dce1e9; border-radius: 7px; background: white; color: #68748a; width: 28px; height: 28px; }
  .month-nav strong { margin-left: 4px; color: #172033; font-size: 13px; }
  .calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); overflow: hidden; border: 1px solid #dce1e9; border-radius: 0 0 13px 13px; }
  .weekday { background: #f6f7fa; padding: 8px; color: #929bad; font-size: 9px; font-weight: 750; text-align: center; letter-spacing: .08em; }
  .day { min-height: 100px; border-right: 1px solid #edf0f4; border-top: 1px solid #edf0f4; padding: 5px; background: white; }
  .day:nth-child(7n) { border-right: 0; }
  .day.empty { background: #fafbfc; }
  .day-number { display: block; margin: 1px 3px 5px; border: 0; background: transparent; padding: 0; color: #7a8497; font-size: 10px; }
  .post-card { margin-top: 4px; border: 1px solid #dce1e9; border-radius: 7px; background: #f8f9fb; padding: 6px; }
  .post-title { display: block; width: 100%; overflow: hidden; border: 0; background: transparent; padding: 0; color: #25304a; font-size: 10px; font-weight: 750; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
  .tags { margin-top: 4px; overflow: hidden; color: #7655d8; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
  .post-meta { justify-content: space-between; gap: 4px; margin-top: 5px; color: #7a8497; font-size: 8px; }
  .post-meta span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .move-actions { justify-content: space-between; margin-top: 5px; }
  .move-actions button { border: 0; background: transparent; padding: 1px; color: #7655d8; font-size: 8px; }
  .error { margin-bottom: 12px; border-radius: 8px; background: #fff1f1; padding: 9px 11px; color: #b42318; font-size: 11px; }
  .overlay { position: fixed; inset: 0; z-index: 10; display: flex; justify-content: flex-end; background: rgba(23, 32, 51, .22); }
  .editor { display: flex; width: min(390px, 94vw); height: 100%; flex-direction: column; gap: 14px; overflow-y: auto; background: white; padding: 20px; box-shadow: -12px 0 30px rgba(23, 32, 51, .14); }
  .editor-heading { justify-content: space-between; margin-bottom: 2px; }
  .close { border-radius: 50%; font-size: 18px; }
  label, legend { color: #5d687d; font-size: 11px; font-weight: 700; }
  label span { font-weight: 400; }
  input, textarea { display: block; width: 100%; margin-top: 6px; border: 1px solid #dce1e9; border-radius: 8px; background: white; padding: 9px 10px; color: #172033; font-size: 12px; font-weight: 400; outline: none; }
  input:focus, textarea:focus { border-color: #9a83df; box-shadow: 0 0 0 2px #eee9ff; }
  textarea { resize: vertical; line-height: 1.5; }
  .schedule-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  fieldset { margin: 0; border: 0; padding: 0; }
  .choices { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 7px; }
  .choices button { border: 1px solid #dce1e9; border-radius: 999px; background: white; padding: 7px 10px; color: #68748a; font-size: 10px; }
  .choices button.active { border-color: #b9a9e8; background: #f1edff; color: #5c3fc0; }
  .editor-actions { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; margin-top: auto; padding-top: 10px; }
  .secondary, .danger { border: 1px solid #dce1e9; border-radius: 8px; background: white; padding: 8px 11px; color: #5d687d; font-size: 11px; font-weight: 700; }
  .danger { border-color: #f2c4c1; color: #b42318; }
  :global(body.dark) .calendar-app { color: #edf0f6; }
  :global(body.dark) .subtitle, :global(body.dark) .toolbar, :global(body.dark) .day-number, :global(body.dark) label, :global(body.dark) legend { color: #9ca6b8; }
  :global(body.dark) .toolbar, :global(body.dark) .calendar, :global(body.dark) .day, :global(body.dark) .post-card, :global(body.dark) input, :global(body.dark) textarea, :global(body.dark) .editor { border-color: #384256; background: #171d29; color: #edf0f6; }
  :global(body.dark) .weekday, :global(body.dark) .day.empty { background: #111722; }
  :global(body.dark) .post-title { color: #edf0f6; }
  :global(body.dark) .month-nav button, :global(body.dark) .close, :global(body.dark) .secondary, :global(body.dark) .danger, :global(body.dark) .choices button { border-color: #384256; background: #202838; }
  @media (max-width: 760px) { .calendar-app { min-width: 0; } .day { min-height: 76px; } .post-meta span:last-child, .move-actions { display: none; } }
</style>
