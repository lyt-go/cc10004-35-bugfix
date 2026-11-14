import { useParams } from 'react-router-dom'

import ProfileDetailView from './ProfileDetailView'

export default function ProfileDetailRoute() {
  const { versionId } = useParams<{ versionId: string }>()
  return <ProfileDetailView versionId={decodeURIComponent(versionId ?? '')} />
}
