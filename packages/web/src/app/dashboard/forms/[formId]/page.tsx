import Link from "next/link"
import { FormEditor } from "./FormEditor"
import { getDashboardSession } from "@/lib/dashboard/server"
import { canManage } from "@/lib/teams/server"

export default async function FormEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ formId: string }>
  searchParams: Promise<{ name?: string }>
}) {
  const { formId } = await params
  const { name } = await searchParams
  const { activeTeam } = await getDashboardSession()

  if (!canManage(activeTeam.role)) {
    return (
      <div className="py-12">
        <h1 className="text-xl font-semibold text-gray-950">Manager access required</h1>
        <p className="mt-2 text-sm text-gray-600">Only team managers can edit and publish forms.</p>
        <Link
          href="/dashboard/forms"
          className="mt-5 inline-flex text-sm font-medium text-teal-600"
        >
          Back to forms
        </Link>
      </div>
    )
  }

  return (
    <FormEditor
      key={`${activeTeam.id}:${formId}`}
      teamId={activeTeam.id}
      formId={formId}
      initialName={name}
    />
  )
}
