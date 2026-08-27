import { redirect } from 'next/navigation'

export default async function RacineEtablissement({
  params,
}: {
  params: Promise<{ restaurant: string }>
}) {
  const { restaurant } = await params
  redirect(`/${restaurant}/journee`)
}
