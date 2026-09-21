import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, Captions, Check, ChevronLeft, ChevronRight, Eye, EyeOff, Languages, LogOut, MessageCircle, MoreHorizontal, Pause, Play, Repeat2, RotateCcw, Star, UserRound, X } from 'lucide-react'
import { getProject } from './storage'
import type { LearningCourse, LearningProgress } from './course'
import LearnerAuth from './LearnerAuth'
import { getMe, getProgress, getStats, learnerApiUrl, logout, saveProgress, sendFeedback, TOKEN_KEY, type LearnerUser, type LearningStats } from './learnerApi'
import { getOfflineCourse } from './learnerStorage'
import { isNativeApp } from './runtime'
import { saveSentence, saveWord, segmentJapanese } from './learnerVocabulary'
import type { LearningToken } from './course'
import LearnerBottomNav from './LearnerBottomNav'
import { toHiragana } from './materialQuality'

const formatTime = (seconds: number) => {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}

function progressKey(courseId: string) {
  return `echo-loop-learning-progress:${courseId}`
}

function readProgress(courseId: string): LearningProgress {
  try {
    const stored = JSON.parse(localStorage.getItem(progressKey(courseId)) || '{}')
    return {
      position: Number(stored.position) || 0,
      completedCueIds: Array.isArray(stored.completedCueIds) ? stored.completedCueIds : [],
      speed: Number(stored.speed) || 1,
      bookmarkedCueIds: Array.isArray(stored.bookmarkedCueIds) ? stored.bookmarkedCueIds : [],
      totalSeconds: Number(stored.totalSeconds) || 0,
      updatedAt: Number(stored.updatedAt) || 0,
    }
  } catch {
    return { position: 0, completedCueIds: [], bookmarkedCueIds: [], totalSeconds: 0, speed: 1, updatedAt: 0 }
  }
}

async function loadCourse(): Promise<{ course: LearningCourse; revoke?: () => void }> {
  const url = new URL(window.location.href)
  const parts = url.pathname.split('/').filter(Boolean)
  const courseId = decodeURIComponent(parts[1] || '')
  const nativeOfflineId = url.searchParams.get('offline')
  if (nativeOfflineId) {
    const stored = await getOfflineCourse(nativeOfflineId)
    if (!stored) throw new Error('本机素材不存在，请重新导入学习包。')
    const mediaUrl = URL.createObjectURL(stored.media)
    return { course: { ...stored.course, mediaUrl }, revoke: () => URL.revokeObjectURL(mediaUrl) }
  }
  if (courseId === 'offline') {
    const storedId = decodeURIComponent(parts[2] || '')
    const stored = await getOfflineCourse(storedId)
    if (!stored) throw new Error('本机素材不存在，请重新导入学习包。')
    const mediaUrl = URL.createObjectURL(stored.media)
    return { course: { ...stored.course, mediaUrl }, revoke: () => URL.revokeObjectURL(mediaUrl) }
  }
  if (courseId === 'local') {
    const projectId = url.searchParams.get('project') || ''
    const project = await getProject(projectId)
    if (!project) throw new Error('本地素材不存在，请返回制作端重新打开项目。')
    const mediaUrl = URL.createObjectURL(project.media)
    return {
      course: {
        id: `local:${project.id}`,
        title: project.fileName.replace(/\.[^.]+$/, ''),
        description: '本地素材预览',
        language: project.detectedLanguage,
        mediaUrl,
        mediaType: project.fileType,
        duration: project.duration,
        cues: project.cues,
      },
      revoke: () => URL.revokeObjectURL(mediaUrl),
    }
  }
  if (!courseId) throw new Error('素材地址无效。')
  const response = await fetch(learnerApiUrl(`/courses/${encodeURIComponent(courseId)}`))
  if (!response.ok) throw new Error(response.status === 404 ? '素材不存在或已经下架。' : '暂时无法取得素材，请稍后再试。')
  return { course: await response.json() as LearningCourse }
}

export default function LearnerApp() {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const cueListRef = useRef<HTMLDivElement>(null)
  const cueRefs = useRef(new Map<number, HTMLButtonElement>())
  const progressRef = useRef({ position: 0, speed: 1, completedCueIds: [] as number[], bookmarkedCueIds: [] as number[] })
  const [course, setCourse] = useState<LearningCourse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [loopCue, setLoopCue] = useState(false)
  const [showCaption, setShowCaption] = useState(true)
  const [captionExpanded, setCaptionExpanded] = useState(false)
  const [selectedToken, setSelectedToken] = useState<LearningToken | null>(null)
  const [translationLanguage, setTranslationLanguage] = useState(() => localStorage.getItem('echo-loop-translation-language') || 'zh-CN')
  const [showTranslation, setShowTranslation] = useState(true)
  const [showReading, setShowReading] = useState(true)
  const [savedNotice, setSavedNotice] = useState('')
  const [completed, setCompleted] = useState<number[]>([])
  const [bookmarked, setBookmarked] = useState<number[]>([])
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const nativeOfflineCourse = isNativeApp && new URL(window.location.href).searchParams.has('offline') && !token
  const [user, setUser] = useState<LearnerUser | null>(() => nativeOfflineCourse ? { id: 'offline', email: '', displayName: '离线学习' } : null)
  const [authChecking, setAuthChecking] = useState(!nativeOfflineCourse)
  const [progressLoaded, setProgressLoaded] = useState(false)
  const [courseSeconds, setCourseSeconds] = useState(0)
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState('general')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('')

  useEffect(() => {
    document.body.classList.add('learner-body')
    window.history.scrollRestoration = 'manual'
    window.scrollTo({ top: 0 })
    let revoke: (() => void) | undefined
    void loadCourse().then(result => {
      revoke = result.revoke
      const progress = readProgress(result.course.id)
      setCourse(result.course)
      setPosition(Math.min(progress.position, result.course.duration || progress.position))
      setSpeed(progress.speed)
      setCompleted(progress.completedCueIds)
      setBookmarked(progress.bookmarkedCueIds || [])
      setCourseSeconds(progress.totalSeconds || 0)
    }).catch(reason => setError(reason instanceof Error ? reason.message : '素材加载失败。')).finally(() => setLoading(false))
    return () => {
      document.body.classList.remove('learner-body')
      revoke?.()
    }
  }, [])

  useEffect(() => {
    if (!token) {
      setAuthChecking(false)
      return
    }
    void getMe(token).then(result => setUser(result.user)).catch(() => {
      localStorage.removeItem(TOKEN_KEY)
      setToken('')
    }).finally(() => setAuthChecking(false))
  }, [token])

  const activeIndex = useMemo(() => {
    if (!course) return -1
    if (!course.cues.length) return -1
    const exact = course.cues.findIndex(cue => position >= cue.start && position < cue.end)
    if (exact >= 0) return exact
    for (let index = course.cues.length - 1; index >= 0; index -= 1) {
      if (course.cues[index].start <= position) return index
    }
    // Many subtitle files start a fraction of a second after the media. Show
    // the first sentence while paused at 0:00 instead of rendering an empty
    // learning area.
    return 0
  }, [course, position])
  const activeCue = activeIndex >= 0 ? course?.cues[activeIndex] : undefined
  const activeTokens = useMemo(() => activeCue ? (activeCue.tokens?.length ? activeCue.tokens : segmentJapanese(activeCue.text)) : [], [activeCue])
  const activeTranslation = activeCue?.translations?.[translationLanguage] || activeCue?.translation || ''
  progressRef.current = { position, speed, completedCueIds: completed, bookmarkedCueIds: bookmarked }

  useEffect(() => {
    if (!course) return
    const handle = window.setTimeout(() => {
      const progress: LearningProgress = { position, completedCueIds: completed, bookmarkedCueIds: bookmarked, totalSeconds: courseSeconds, speed, updatedAt: Date.now() }
      localStorage.setItem(progressKey(course.id), JSON.stringify(progress))
    }, 350)
    return () => window.clearTimeout(handle)
  }, [course, position, completed, bookmarked, courseSeconds, speed])

  useEffect(() => {
    if (!course || !token || !user) return
    setProgressLoaded(false)
    void getProgress(token, course.id).then(server => {
      setPosition(server.position)
      setSpeed(server.speed)
      setCompleted(server.completedCueIds)
      setBookmarked(server.bookmarkedCueIds)
      setCourseSeconds(server.totalSeconds)
    }).catch(() => undefined).finally(() => setProgressLoaded(true))
  }, [course?.id, token, user?.id])

  useEffect(() => {
    if (!course || !token || !progressLoaded) return
    const handle = window.setTimeout(() => {
      void saveProgress(token, course.id, { position, speed, completedCueIds: completed, bookmarkedCueIds: bookmarked })
        .then(saved => setCourseSeconds(saved.totalSeconds))
        .catch(() => undefined)
    }, 600)
    return () => window.clearTimeout(handle)
  }, [course, token, progressLoaded, position, speed, completed, bookmarked])

  useEffect(() => {
    if (!playing || !course || (token && !progressLoaded)) return
    let pendingSeconds = 0
    const flush = () => {
      if (!pendingSeconds) return
      const learnedSeconds = pendingSeconds
      pendingSeconds = 0
      const current = progressRef.current
      if (!token) {
        setCourseSeconds(value => value + learnedSeconds)
        return
      }
      void saveProgress(token, course.id, { ...current, learnedSeconds, eventId: crypto.randomUUID() }).then(saved => setCourseSeconds(saved.totalSeconds)).catch(() => { pendingSeconds += learnedSeconds })
    }
    const timer = window.setInterval(() => {
      pendingSeconds += 1
      if (pendingSeconds >= 15) flush()
    }, 1000)
    return () => {
      window.clearInterval(timer)
      flush()
    }
  }, [playing, course?.id, token, progressLoaded])

  useEffect(() => {
    if (!activeCue) return
    const container = cueListRef.current
    const cueElement = cueRefs.current.get(activeCue.id)
    if (!container || !cueElement || container.scrollHeight <= container.clientHeight + 1) return
    const containerRect = container.getBoundingClientRect()
    const cueRect = cueElement.getBoundingClientRect()
    if (cueRect.top < containerRect.top) {
      container.scrollBy({ top: cueRect.top - containerRect.top - 8, behavior: 'smooth' })
    } else if (cueRect.bottom > containerRect.bottom) {
      container.scrollBy({ top: cueRect.bottom - containerRect.bottom + 8, behavior: 'smooth' })
    }
  }, [activeCue?.id])

  useEffect(() => {
    setCaptionExpanded(false)
    setSelectedToken(null)
    setSavedNotice('')
  }, [activeCue?.id])

  const seek = (value: number) => {
    const media = mediaRef.current
    if (!media) return
    media.currentTime = Math.max(0, Math.min(value, media.duration || course?.duration || value))
    setPosition(media.currentTime)
  }
  const selectCue = (index: number, autoplay = true) => {
    const cue = course?.cues[index]
    if (!cue) return
    seek(cue.start)
    if (autoplay) void mediaRef.current?.play()
  }
  const togglePlay = () => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }
  const cycleSpeed = () => {
    const speeds = [0.75, 1, 1.25, 1.5]
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length]
    setSpeed(next)
    if (mediaRef.current) mediaRef.current.playbackRate = next
  }
  const replayCue = () => {
    if (!activeCue) return
    seek(activeCue.start)
    void mediaRef.current?.play()
  }
  const onTimeUpdate = () => {
    const media = mediaRef.current
    if (!media) return
    const current = media.currentTime
    setPosition(current)
    if (activeCue && current >= activeCue.end - 0.04) {
      setCompleted(previous => previous.includes(activeCue.id) ? previous : [...previous, activeCue.id])
      if (loopCue) {
        media.currentTime = activeCue.start
        void media.play()
      }
    }
  }
  const notifySaved = (message: string) => {
    setSavedNotice(message)
    window.setTimeout(() => setSavedNotice(current => current === message ? '' : current), 1600)
  }
  const addSelectedWord = () => {
    if (!selectedToken || !course || !activeCue) return
    saveWord(selectedToken, course.id, course.title, activeCue.id)
    notifySaved(`“${selectedToken.surface}”已加入单词本`)
  }
  const addCurrentSentence = () => {
    if (!course || !activeCue) return
    saveSentence(activeCue, course.id, course.title)
    setBookmarked(previous => previous.includes(activeCue.id) ? previous : [...previous, activeCue.id])
    notifySaved('当前句已加入句子本')
  }
  const returnToLibrary = () => {
    window.location.href = isNativeApp ? '/?screen=courses' : '/learn/courses'
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlay()
      } else if (event.key.toLowerCase() === 'w' && !event.repeat) {
        addSelectedWord()
      } else if (event.key.toLowerCase() === 's' && !event.repeat) {
        addCurrentSentence()
      } else if (event.key.toLowerCase() === 'r' && !event.repeat) {
        replayCue()
      } else if (event.key.toLowerCase() === 'l' && !event.repeat) {
        setLoopCue(value => !value)
      } else if (event.key.toLowerCase() === 'h' && !event.repeat) {
        setShowCaption(value => !value)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        seek(position - 3)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        seek(position + 3)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        selectCue(activeIndex - 1)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        selectCue(activeIndex + 1)
      } else if (event.key.toLowerCase() === 't' && !event.repeat) {
        setShowTranslation(value => !value)
      } else if (event.key.toLowerCase() === 'f' && !event.repeat) {
        setShowReading(value => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedToken, activeCue?.id, course?.id, position, activeIndex])

  if (authChecking) return <main className="learner-state"><span className="learner-spinner"/><h1>正在确认账户</h1><p>正在恢复你的学习记录…</p></main>
  if (!user) return <LearnerAuth onAuthenticated={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); setAuthChecking(false) }} onOffline={() => setUser({ id: 'offline', email: '仅保存在当前设备', displayName: '离线学习' })}/>
  if (loading) return <main className="learner-state"><span className="learner-spinner"/><h1>素材加载中</h1><p>正在准备媒体和字幕…</p></main>
  if (error || !course) return <main className="learner-state error"><h1>无法打开素材</h1><p>{error}</p><button onClick={() => { window.location.href = '/' }}><ArrowLeft size={16}/>返回 EchoLoop</button></main>

  return <div className={`learner-shell ${isNativeApp ? 'native-learner' : ''}`}>
    <header className="learner-header">
      <button className="learner-back" onClick={returnToLibrary} aria-label="返回素材库"><ArrowLeft/></button>
      <div><span>{course.language || '语言学习'}{course.level ? ` · ${course.level}` : ''}</span><h1>{course.title}</h1></div>
      <button className="learner-more" onClick={() => { setAccountOpen(true); if(token)void getStats(token).then(setStats);else setStats({totalSeconds:courseSeconds,courseCount:1,completedCueCount:completed.length}) }} aria-label="更多"><MoreHorizontal/></button>
    </header>
    <main className="learner-main">
      <section className="learner-player-card">
        <div className="learner-media">
          <video ref={mediaRef} src={course.mediaUrl} playsInline preload="metadata" onLoadedMetadata={event => { event.currentTarget.currentTime = position; event.currentTarget.playbackRate = speed }} onTimeUpdate={onTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}/>
        </div>
        <div className="learner-timeline">
          <input type="range" min="0" max={course.duration || 1} step="0.05" value={position} onChange={event => seek(Number(event.target.value))}/>
          <span>{formatTime(position)}</span><span>{formatTime(course.duration)}</span>
        </div>
        <div className="learner-controls">
          <button onClick={() => selectCue(activeIndex - 1)} aria-label="上一句"><ChevronLeft/></button>
          <button className="learner-play" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button>
          <button onClick={() => selectCue(activeIndex + 1)} aria-label="下一句"><ChevronRight/></button>
        </div>
        <div className="learner-tools" aria-label="学习播放操作">
          <button className={loopCue ? 'active' : ''} onClick={() => setLoopCue(value => !value)}><Repeat2/>单句循环</button>
          <button onClick={cycleSpeed}><span className="learner-speed-value">{speed}×</span>播放速度</button>
          <button className={!showCaption ? 'active' : ''} onClick={() => setShowCaption(value => !value)}>{showCaption ? <EyeOff/> : <Eye/>}{showCaption ? '隐藏字幕' : '显示字幕'}</button>
          <button onClick={replayCue}><RotateCcw/>重听本句</button>
        </div>
        {activeCue && <section className={`learner-current-caption ${captionExpanded ? 'expanded' : ''}`}>
          <header><div className="learner-caption-heading"><span>当前句</span><button className={`learner-reading-toggle ${showReading ? 'active' : ''}`} onClick={() => setShowReading(value => !value)}><i/>平假名</button><button className={`learner-reading-toggle ${showTranslation ? 'active' : ''}`} onClick={() => setShowTranslation(value => !value)}><i/>译文</button>{(activeCue.text.length > 58 || activeTranslation.length > 76) && <button className="learner-inline-expand" onClick={() => setCaptionExpanded(value => !value)}>{captionExpanded ? '收起' : '显示全文'}</button>}</div><small>{activeIndex + 1} / {course.cues.length}</small></header>
          {showCaption ? <>
            <div className="learner-token-line">{activeTokens.map((word, index) => /[\p{L}\p{N}]/u.test(word.surface) ? <button key={`${word.surface}-${index}`} className={selectedToken === word ? 'selected' : ''} onClick={() => setSelectedToken(word)}>{showReading && /\p{Script=Han}/u.test(word.surface) && (word.reading || word.readingKatakana) ? <ruby>{word.surface}<rt>{toHiragana(word.reading || word.readingKatakana || '')}</rt></ruby> : word.surface}</button> : <span key={`${word.surface}-${index}`}>{word.surface}</span>)}</div>
            {showTranslation && <div className="learner-translation"><label><Languages/><select value={translationLanguage} onChange={event => { setTranslationLanguage(event.target.value); localStorage.setItem('echo-loop-translation-language', event.target.value) }}><option value="zh-CN">中文</option><option value="en">English</option></select></label><p>{activeTranslation || '当前学习包暂未提供译文'}</p></div>}
          </> : <button className="learner-caption-reveal" onClick={() => setShowCaption(true)}><Eye/>字幕已隐藏，点击显示</button>}
          <div className="learner-caption-actions"><button disabled={!selectedToken} onClick={addSelectedWord}><Star fill={selectedToken ? 'currentColor' : 'none'}/>{selectedToken ? `加入“${selectedToken.surface}”` : '先选择单词'}<kbd>W</kbd></button><button className={bookmarked.includes(activeCue.id) ? 'saved' : ''} onClick={addCurrentSentence}><Bookmark fill={bookmarked.includes(activeCue.id) ? 'currentColor' : 'none'}/>收藏句子<kbd>S</kbd></button></div>
          {savedNotice && <div className="learner-saved-notice">{savedNotice}</div>}
        </section>}
        {!activeCue && <section className="learner-current-caption learner-caption-empty"><Captions/><div><b>这个素材没有可用字幕</b><p>请回到制作端生成或导入字幕，完成素材检查后重新导出。</p></div></section>}
      </section>

      <section className="learner-transcript">
        <div className="learner-section-title"><div><Captions/><span>原文与字幕</span></div><small>{completed.length} / {course.cues.length} · {formatTime(courseSeconds)}</small></div>
        <div className="learner-cues" ref={cueListRef}>
          {course.cues.map((cue, index) => <button key={cue.id} ref={element => { if (element) cueRefs.current.set(cue.id, element); else cueRefs.current.delete(cue.id) }} className={index === activeIndex ? 'active' : ''} onClick={() => selectCue(index)}>
            <span className="learner-cue-time">{formatTime(cue.start)}</span>
            <span className="learner-cue-copy"><b>{cue.text}</b>{cue.translation && <small>{cue.translation}</small>}</span>
            {!isNativeApp && <span className="learner-cue-actions"><i className={completed.includes(cue.id) ? 'done' : ''}>{completed.includes(cue.id) && <Check/>}</i><i className={bookmarked.includes(cue.id) ? 'saved' : ''} onClick={event => { event.stopPropagation(); setBookmarked(previous => previous.includes(cue.id) ? previous.filter(id => id !== cue.id) : [...previous, cue.id]) }}><Bookmark fill={bookmarked.includes(cue.id) ? 'currentColor' : 'none'}/></i></span>}
          </button>)}
        </div>
      </section>
    </main>
    <LearnerBottomNav active="study"/>
    {accountOpen && <div className="learner-modal-backdrop" onMouseDown={() => setAccountOpen(false)}><section className="learner-modal" onMouseDown={event => event.stopPropagation()}><button className="learner-modal-close" onClick={() => setAccountOpen(false)}><X/></button><div className="learner-account-head"><span><UserRound/></span><div><h2>{user.displayName}</h2><p>{user.email}</p></div></div><div className="learner-stats"><div><b>{formatTime(stats?.totalSeconds || 0)}</b><span>累计学习</span></div><div><b>{stats?.courseCount || 0}</b><span>学习课程</span></div><div><b>{stats?.completedCueCount || 0}</b><span>完成句子</span></div></div><button className="learner-logout" onClick={() => { if(token)void logout(token); localStorage.removeItem(TOKEN_KEY); setToken(''); setUser(null); setAccountOpen(false) }}><LogOut/>{token?'退出登录':'退出离线学习'}</button></section></div>}
    {feedbackOpen && <div className="learner-modal-backdrop" onMouseDown={() => setFeedbackOpen(false)}><section className="learner-modal" onMouseDown={event => event.stopPropagation()}><button className="learner-modal-close" onClick={() => setFeedbackOpen(false)}><X/></button><h2>学习反馈</h2><p className="learner-modal-note">{token?'反馈会附带当前课程和播放位置，方便我们快速定位。':'当前为离线学习。登录后才能将反馈发送到服务器。'}</p><label className="learner-feedback-field">问题类型<select value={feedbackCategory} onChange={event => setFeedbackCategory(event.target.value)}><option value="general">一般反馈</option><option value="subtitle">字幕问题</option><option value="media">播放问题</option><option value="suggestion">功能建议</option></select></label><label className="learner-feedback-field">反馈内容<textarea value={feedbackMessage} onChange={event => setFeedbackMessage(event.target.value)} placeholder="请描述遇到的问题或你的建议…" maxLength={2000}/></label>{feedbackStatus && <p className="learner-feedback-status">{feedbackStatus}</p>}<button className="learner-feedback-submit" disabled={!token||feedbackMessage.trim().length < 5} onClick={() => { setFeedbackStatus('正在发送…'); void sendFeedback(token,{courseId:course.id,category:feedbackCategory,message:feedbackMessage,position}).then(() => { setFeedbackStatus('已收到，感谢你的反馈'); setFeedbackMessage('') }).catch(reason => setFeedbackStatus(reason instanceof Error ? reason.message : '发送失败')) }}><MessageCircle/>提交反馈</button></section></div>}
  </div>
}
