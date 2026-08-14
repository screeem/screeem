import { ScheduleCalendar } from "./ScheduleCalendar"
import { getDashboardSession } from "@/lib/dashboard/server"

export default async function CalendarPage() {
  const { activeTeam } = await getDashboardSession()
  return <ScheduleCalendar teamId={activeTeam.id} />
}
