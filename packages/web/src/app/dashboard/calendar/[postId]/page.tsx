import { getDashboardSession } from "@/lib/dashboard/server"
import { CalendarPostDetail } from "./CalendarPostDetail"

export default async function CalendarPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const [{ activeTeam, user }, { postId }] = await Promise.all([getDashboardSession(), params])
  return <CalendarPostDetail
    teamId={activeTeam.id}
    postId={postId}
    currentUserId={user.id}
    role={activeTeam.role}
  />
}
