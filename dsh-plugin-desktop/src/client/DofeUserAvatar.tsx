import { useState } from 'react'
import { UserRound } from 'lucide-react'

/** Both account surfaces use the same image and recover when its URL changes. */
export function DofeUserAvatar({ avatar, size = 20 }: { avatar?: string | null | undefined; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const source = avatar?.trim()
  return <span className="dshDofeAccessAvatar" aria-hidden="true">
    {source && source !== failedUrl
      ? <img key={source} src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(source)} />
      : <UserRound size={size} />}
  </span>
}
