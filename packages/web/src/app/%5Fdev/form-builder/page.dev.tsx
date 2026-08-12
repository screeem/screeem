import { notFound } from "next/navigation"
import { FormBuilderPlayground } from "./FormBuilderPlayground"

export default function DevelopmentFormBuilderPage() {
  if (process.env.NODE_ENV === "production") notFound()

  return <FormBuilderPlayground />
}
