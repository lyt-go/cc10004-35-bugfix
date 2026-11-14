import { useParams } from 'react-router-dom'

import SchemeDetailView from './SchemeDetailView'

export default function AbgroupDetailRoute() {
  const { schemeCode } = useParams<{ schemeCode: string }>()
  return <SchemeDetailView schemeCode={decodeURIComponent(schemeCode ?? '')} />
}
