export const socialPlatformDefinitions = [
  {
    id: "twitter",
    name: "Twitter / X",
    calendarTarget: "X",
    badge: "X",
    prefix: "@",
    placeholder: "handle",
    urlBase: "https://x.com/",
    avatarBase: "https://unavatar.io/twitter/",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    calendarTarget: "LinkedIn",
    badge: "in",
    prefix: "linkedin.com/in/",
    placeholder: "handle",
    urlBase: "https://linkedin.com/in/",
    avatarBase: "https://unavatar.io/linkedin/",
  },
  {
    id: "instagram",
    name: "Instagram",
    calendarTarget: "Instagram",
    badge: "I",
    prefix: "@",
    placeholder: "handle",
    urlBase: "https://instagram.com/",
    avatarBase: "https://unavatar.io/instagram/",
  },
] as const

export type SocialPlatform = (typeof socialPlatformDefinitions)[number]["id"]
export type CalendarTarget = (typeof socialPlatformDefinitions)[number]["calendarTarget"]
export type SocialPlatformDefinition = (typeof socialPlatformDefinitions)[number]

export const socialPlatformById = Object.fromEntries(
  socialPlatformDefinitions.map((definition) => [definition.id, definition]),
) as Record<SocialPlatform, SocialPlatformDefinition>

export const calendarTargets = socialPlatformDefinitions.map(
  (definition) => definition.calendarTarget,
) as CalendarTarget[]

export function socialPlatformDefinitionForTarget(target: CalendarTarget) {
  return socialPlatformDefinitions.find((definition) => definition.calendarTarget === target)!
}

export function configuredCalendarTargets(accounts: readonly { platform: string }[]) {
  const configuredPlatforms = new Set(accounts.map((account) => account.platform))
  return socialPlatformDefinitions
    .filter((definition) => configuredPlatforms.has(definition.id))
    .map((definition) => definition.calendarTarget)
}
