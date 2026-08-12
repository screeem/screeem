import { HostedForm } from "./HostedForm"

export default async function HostedFormPage({
  params,
}: {
  params: Promise<{ endpointKey: string }>
}) {
  const { endpointKey } = await params
  return <HostedForm endpointKey={endpointKey} />
}
