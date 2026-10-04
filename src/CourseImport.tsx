import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileArchive, Import, Play, ShieldCheck } from 'lucide-react'
import { importCoursePackage } from './coursePackage'
import { listOfflineCourses, saveOfflineCourse } from './learnerStorage'
import type { ImportedCoursePackage } from './coursePackage'
import { isNativeApp } from './runtime'
import { getAvailableCourses, TOKEN_KEY, type PublishedCourseSummary } from './learnerApi'

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`
const openCourse = (id: string) => {
  window.location.href = isNativeApp ? `/?offline=${encodeURIComponent(id)}` : `/learn/offline/${encodeURIComponent(id)}`
}
const openPublishedCourse = (id: string) => {
  window.location.href = isNativeApp ? `/?course=${encodeURIComponent(id)}` : `/learn/${encodeURIComponent(id)}`
}

export default function CourseImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [courses, setCourses] = useState<ImportedCoursePackage[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [published, setPublished] = useState<PublishedCourseSummary[]>([])
  const [serverMessage, setServerMessage] = useState('')

  useEffect(() => {
    void listOfflineCourses().then(setCourses)
    void getAvailableCourses(localStorage.getItem(TOKEN_KEY) || '').then(result => setPublished(result.courses)).catch(reason => setServerMessage(reason instanceof Error ? reason.message : '无法读取服务器素材'))
  }, [])
  const importFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setMessage(`正在读取 ${formatSize(file.size)} 的学习包…`)
    try {
      const imported = await importCoursePackage(file)
      setMessage('正在保存到本机…')
      await saveOfflineCourse(imported)
      openCourse(imported.course.id)
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '素材导入失败')
      setBusy(false)
    }
  }

  return <main className="course-import-page">
    <section className="course-import-hero">
      <div className="course-import-brand"><span><BookOpen/></span><b>EchoLoop 学习端</b></div>
      <h1>导入素材，随时开始精听</h1>
      <p>学习素材和字幕保存在当前设备，重复学习不会消耗发布者的服务器视频流量。</p>
      <button onClick={() => inputRef.current?.click()} disabled={busy}><Import/>{busy ? '正在导入…' : '导入 .echoloop 学习包'}</button>
      <input ref={inputRef} hidden type="file" accept={isNativeApp ? '*/*' : '.echoloop,application/vnd.echoloop.course+zip,application/zip'} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = '' }}/>
      {message && <div className={`course-import-message ${busy ? 'busy' : ''}`}>{message}</div>}
      <div className="course-import-trust"><span><FileArchive/>媒体保存在本机</span><span><ShieldCheck/>导入前验证格式</span></div>
    </section>
    <section className="offline-library"><div className="offline-library-title"><h2>可阅览内容</h2><span>{published.length} 个</span></div>{published.map(item => <button key={item.id} onClick={() => openPublishedCourse(item.id)}><span className="offline-course-icon"><Play/></span><span><b>{item.title}</b><small>{item.language || '语言学习'} · {Math.round(item.duration / 60)} 分钟 · {item.cueCount} 句{item.visibility === 'selected' ? ' · 专属内容' : ''}</small></span><Play/></button>)}{!published.length && <p className="offline-library-empty">{serverMessage || '当前没有已发布且可阅览的内容'}</p>}</section>
    {courses.length > 0 && <section className="offline-library"><div className="offline-library-title"><h2>本机素材</h2><span>{courses.length} 个</span></div>{courses.map(item => <button key={item.course.id} onClick={() => openCourse(item.course.id)}><span className="offline-course-icon"><Play/></span><span><b>{item.course.title}</b><small>{item.course.language || '语言学习'} · {Math.round(item.course.duration / 60)} 分钟 · {item.course.cues.length} 句</small></span><Play/></button>)}</section>}
  </main>
}
