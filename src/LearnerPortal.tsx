import { useEffect, useState } from 'react'
import { BookOpen, Clock3, Import, LogOut, Play } from 'lucide-react'
import CourseImport from './CourseImport'
import LearnerAuth from './LearnerAuth'
import { getMe, getStats, logout, TOKEN_KEY, type LearnerUser, type LearningStats } from './learnerApi'
import { listOfflineCourses } from './learnerStorage'
import type { ImportedCoursePackage } from './coursePackage'
import { isNativeApp } from './runtime'
import LearnerBottomNav from './LearnerBottomNav'
import VocabularyLibrary from './VocabularyLibrary'

const requestedSection = isNativeApp ? new URL(window.location.href).searchParams.get('screen') : window.location.pathname.split('/').filter(Boolean)[1]
const libraryRequested = requestedSection === 'courses' || requestedSection === 'materials'
const vocabularyRequested = requestedSection === 'vocabulary'
const profileRequested = requestedSection === 'profile'

function openCourse(id: string) {
  window.location.href = isNativeApp ? `/?offline=${encodeURIComponent(id)}` : `/learn/offline/${encodeURIComponent(id)}`
}

function openLibrary() {
  window.location.href = isNativeApp ? '/?screen=courses' : '/learn/courses'
}

export default function LearnerPortal() {
  const [checking, setChecking] = useState(true)
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [user, setUser] = useState<LearnerUser | null>(null)
  const [courses, setCourses] = useState<ImportedCoursePackage[]>([])
  const [stats, setStats] = useState<LearningStats | null>(null)

  useEffect(() => {
    void listOfflineCourses().then(setCourses)
    if (!token) {
      setChecking(false)
      return
    }
    void getMe(token).then(result => {
      setUser(result.user)
      void getStats(token).then(setStats).catch(() => undefined)
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      setToken('')
    }).finally(() => setChecking(false))
  }, [token])

  if (checking) return <main className="learner-state"><span className="learner-spinner"/><h1>正在进入学习端</h1><p>正在恢复你的账户和学习记录…</p></main>
  if (!user) return <LearnerAuth onAuthenticated={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser) }} onOffline={() => setUser({ id: 'offline', email: '本机模式', displayName: '离线学习' })}/>
  if (libraryRequested) return <><CourseImport/><LearnerBottomNav active="materials"/></>
  if (vocabularyRequested) return <VocabularyLibrary/>
  if (profileRequested) return <main className="learner-portal"><header className="learner-portal-header"><div className="learner-portal-brand"><span><BookOpen/></span><div><b>我的学习</b><small>{user.email || '本机离线模式'}</small></div></div></header><section className="learner-portal-main"><div className="learner-portal-summary"><div><Clock3/><span><b>{Math.round((stats?.totalSeconds || 0) / 60)}</b> 分钟</span><small>累计学习</small></div><div><BookOpen/><span><b>{courses.length}</b> 个</span><small>本机素材</small></div></div><button className="learner-profile-logout" onClick={() => { if (token) void logout(token); localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null) }}><LogOut/>退出当前账户</button></section><LearnerBottomNav active="profile"/></main>

  const recent = courses[0]
  return <main className="learner-portal">
    <header className="learner-portal-header">
      <div className="learner-portal-brand"><span><BookOpen/></span><div><b>EchoLoop 学习端</b><small>你好，{user.displayName}</small></div></div>
      <button aria-label="退出学习端" onClick={() => { if (token) void logout(token); localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null) }}><LogOut/></button>
    </header>
    <section className="learner-portal-main">
      <div className="learner-portal-intro"><small>今日学习</small><h1>{recent ? '继续上次的学习' : '从一份素材开始学习'}</h1><p>{recent ? recent.course.title : '导入 EchoLoop 学习包，素材和进度都会保存在当前设备。'}</p>{recent ? <button onClick={() => openCourse(recent.course.id)}><Play/>继续学习</button> : <button onClick={openLibrary}><Import/>导入素材</button>}</div>
      <div className="learner-portal-summary"><div><Clock3/><span><b>{Math.round((stats?.totalSeconds || 0) / 60)}</b> 分钟</span><small>累计学习</small></div><div><BookOpen/><span><b>{courses.length}</b> 个</span><small>本机素材</small></div></div>
      {courses.length > 0 && <section className="learner-portal-courses"><div><h2>最近学习</h2><button onClick={openLibrary}>全部素材</button></div>{courses.slice(0, 3).map(item => <button key={item.course.id} onClick={() => openCourse(item.course.id)}><span><b>{item.course.title}</b><small>{Math.round(item.course.duration / 60)} 分钟 · {item.course.cues.length} 句</small></span><Play/></button>)}</section>}
    </section>
    <LearnerBottomNav active="study"/>
  </main>
}
