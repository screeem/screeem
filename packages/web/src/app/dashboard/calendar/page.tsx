import { ScheduleCalendar } from "./ScheduleCalendar"
import { getDashboardSession } from "@/lib/dashboard/server"
import { canManage } from "@/lib/teams/server"

export default async function CalendarPage() {
  const { activeTeam } = await getDashboardSession()
  return <ScheduleCalendar teamId={activeTeam.id} canManageAccounts={canManage(activeTeam.role)} />
}
