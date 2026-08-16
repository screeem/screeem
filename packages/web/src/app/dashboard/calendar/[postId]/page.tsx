import { getDashboardSession } from "@/lib/dashboard/server"
import { CalendarPostDetail } from "./CalendarPostDetail"

export default async function CalendarPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const [{ activeTeam }, { postId }] = await Promise.all([getDashboardSession(), params])
  return <CalendarPostDetail teamId={activeTeam.id} postId={postId} />
}
