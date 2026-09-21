import { BookOpen, FolderOpen, UserRound, WholeWord } from 'lucide-react'
import { createPortal } from 'react-dom'
import { isNativeApp } from './runtime'

export type LearnerSection = 'study' | 'materials' | 'vocabulary' | 'profile'

function go(section: LearnerSection) {
  if (isNativeApp) {
    window.location.href = section === 'study' ? '/' : `/?screen=${section}`
    return
  }
  const paths: Record<LearnerSection, string> = { study: '/learn', materials: '/learn/courses', vocabulary: '/learn/vocabulary', profile: '/learn/profile' }
  window.location.href = paths[section]
}

export default function LearnerBottomNav({ active }: { active: LearnerSection }) {
  const navigation = <nav
    className="learner-app-nav"
    aria-label="学习端主菜单"
    style={{
      position: 'fixed',
      left: '50%',
      right: 'auto',
      bottom: 0,
      transform: 'translateX(-50%)',
      zIndex: 2147483000,
      display: 'grid',
      visibility: 'visible',
      opacity: 1,
    }}
  >
    <button className={active === 'study' ? 'active' : ''} onClick={() => go('study')}><BookOpen/>学习</button>
    <button className={active === 'materials' ? 'active' : ''} onClick={() => go('materials')}><FolderOpen/>素材</button>
    <button className={active === 'vocabulary' ? 'active' : ''} onClick={() => go('vocabulary')}><WholeWord/>词汇</button>
    <button className={active === 'profile' ? 'active' : ''} onClick={() => go('profile')}><UserRound/>我的</button>
  </nav>

  return createPortal(navigation, document.body)
}
