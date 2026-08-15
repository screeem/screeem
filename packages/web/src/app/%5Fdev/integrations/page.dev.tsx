import { notFound } from "next/navigation"
import { IntegrationManagementPlayground } from "./IntegrationManagementPlayground"

export default function DevelopmentIntegrationsPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return <IntegrationManagementPlayground />
}
