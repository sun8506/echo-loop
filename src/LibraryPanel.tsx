import { BookOpen, Captions, Clock3, FileAudio, GraduationCap, Play, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { AnalysisSummary, ProjectSummary } from './storage'

type Props = {
  projects: ProjectSummary[]
  onClose: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onReparse: (id: string) => void
  onLearn: (id: string, analysisId?: string) => void
}
type LearnableItem = { project: ProjectSummary; analysis?: AnalysisSummary }

const duration = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor(value % 3600 / 60).toString().padStart(hours ? 2 : 1, '0')
  const rest = (value % 60).toString().padStart(2, '0')
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`
}
const modelName = (model: string) => model === 'nvidia' ? '高级模型' : model === 'whisperx' ? '自然语言' : '静音切分'

export default function LibraryPanel({ projects, onClose, onOpen, onDelete, onReparse, onLearn }: Props) {
  const learnable: LearnableItem[] = projects.flatMap(project => {
    const tasks = project.analyses.filter(item => item.status === 'ready' && item.cueCount)
    if (tasks.length) return tasks.map(analysis => ({ project, analysis }))
    return project.isLearnable ? [{ project }] : []
  })
  return <div className="library-backdrop" onMouseDown={onClose}>
    <section className="library-panel library-panel-wide" onMouseDown={event => event.stopPropagation()}>
      <header className="library-header"><div><span><BookOpen size={20}/></span><div><h2>学习库</h2><p>素材登记、后续解析和学习入口集中在这里</p></div></div><button onClick={onClose}><X size={19}/></button></header>
      <main className="library-content">
        <section className="library-section">
          <div className="library-section-head"><div><FileAudio/><span><b>素材库</b><small>所有已经下载或从本机登记的原始素材</small></span></div><em>{projects.length}</em></div>
          <div className="library-list">{projects.length ? projects.map(project => <article key={project.id} className="library-project">
            <button className="library-project-open" onClick={() => onOpen(project.id)}><span className="library-file"><FileAudio size={21}/></span><div className="library-copy"><b>{project.fileName}</b><span><Clock3 size={12}/>{duration(project.duration)} · {project.fileType.startsWith('audio/') ? '音频' : '视频'}</span><span><Captions size={12}/>{project.readyAnalysisCount ? `${project.readyAnalysisCount} 个可用解析 · ${project.cueCount} 句` : project.runningAnalysisCount ? '解析进行中' : project.isLearnable ? `${project.cueCount} 句旧版解析` : '尚未解析'}</span></div><time>{new Date(project.updatedAt).toLocaleString()}</time></button>
            {project.analyses.length > 0 && <div className="library-job-strip">{project.analyses.slice(0, 3).map(job => <span key={job.id} className={job.status}><b>{job.name}</b>{job.scope === 'full' ? '全素材' : `${duration(job.start)}–${duration(job.end)}`} · {modelName(job.model)}</span>)}</div>}
            <div className="library-project-actions"><button onClick={() => onOpen(project.id)}><Play size={13}/>加载素材</button><button onClick={() => onReparse(project.id)}><RefreshCw size={13}/>{project.readyAnalysisCount ? '新建解析' : '继续解析'}</button><button className="danger" onClick={() => onDelete(project.id)}><Trash2 size={13}/>删除</button></div>
          </article>) : <div className="library-empty"><BookOpen size={32}/><b>素材库还是空的</b><p>登记或下载音视频后，会自动保存在这里；不会自动调用 AI。</p></div>}</div>
        </section>
        <section className="library-section learnable-section">
          <div className="library-section-head"><div><GraduationCap/><span><b>可学习内容</b><small>每个成功的解析任务都是独立学习内容</small></span></div><em>{learnable.length}</em></div>
          <div className="library-learning-list">{learnable.length ? learnable.map(({ project, analysis }) => {
            const learningRange: [number, number] = analysis ? [analysis.start, analysis.end] : project.range
            const cueCount = analysis?.cueCount || project.cueCount
            return <article key={`${project.id}:${analysis?.id || 'legacy'}`} className="library-learning-card"><div className="library-learning-icon"><GraduationCap/></div><div><b>{project.fileName.replace(/\.[^.]+$/, '')}{analysis ? ` · ${analysis.name}` : ''}</b><span>{duration(learningRange[0])}–{duration(learningRange[1])} · {cueCount} 句</span><small>{project.publication?.status === 'published' ? <><ShieldCheck/>已发布到服务器</> : '本机暂存内容'}</small></div><button onClick={() => onLearn(project.id, analysis?.id)}><Play/>开始学习</button><button className="library-edit" onClick={() => onOpen(project.id)}>继续制作</button></article>
          }) : <div className="library-empty compact"><GraduationCap size={30}/><b>还没有可学习内容</b><p>从素材库加载素材并完成一次解析后，会自动出现在这里。</p></div>}</div>
        </section>
      </main>
      <footer>媒体和未发布内容保存在当前浏览器中；清除网站数据会同时删除本地素材库。</footer>
    </section>
  </div>
}
