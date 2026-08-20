"use client"

import { useState } from "react"
import {
  CALENDAR_TAG_LIMIT,
  CALENDAR_TAG_MAX_LENGTH,
  normalizeCalendarTag,
} from "@/lib/calendar/events"

export function CalendarTagEditor({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [value, setValue] = useState("")
  const normalized = normalizeCalendarTag(value)
  const atLimit = tags.length >= CALENDAR_TAG_LIMIT
  const duplicate = tags.some((tag) => tag.toLowerCase() === normalized.toLowerCase())
  const canAdd = Boolean(normalized) && normalized.length <= CALENDAR_TAG_MAX_LENGTH && !atLimit && !duplicate

  function addTag() {
    if (!canAdd) return
    onChange([...tags, normalized])
    setValue("")
  }

  return (
    <fieldset>
      <legend className="text-xs font-semibold text-muted-foreground">Tags</legend>
      {tags.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag.toLowerCase()} className="inline-flex items-center gap-1 rounded-full bg-secondary py-1 pl-2.5 pr-1 text-xs font-medium text-secondary-foreground">
              #{tag}
              <button
                type="button"
                aria-label={`Remove ${tag} tag`}
                onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
                className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-border hover:text-foreground"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <input
          value={value}
          maxLength={CALENDAR_TAG_MAX_LENGTH}
          disabled={atLimit}
          aria-label="New tag"
          placeholder={atLimit ? "Tag limit reached" : "Add a tag"}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault()
              addTag()
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2.5 text-sm font-normal outline-none focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:bg-muted"
        />
        <button
          type="button"
          disabled={!canAdd}
          onClick={addTag}
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      <p className="mt-1 text-xs font-normal text-muted-foreground">{tags.length}/{CALENDAR_TAG_LIMIT} tags · {CALENDAR_TAG_MAX_LENGTH} characters each</p>
    </fieldset>
  )
}
