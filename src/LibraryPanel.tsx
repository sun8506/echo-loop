import { BookOpen, Captions, Clock3, FileAudio, RefreshCw, Trash2, X } from 'lucide-react'
import type { ProjectSummary } from './storage'

type Props = {
  projects: ProjectSummary[]
  onClose: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onReparse: (id: string) => void
}

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`

export default function LibraryPanel({ projects, onClose, onOpen, onDelete, onReparse }: Props) {
  return <div className="library-backdrop" onMouseDown={onClose}>
    <section className="library-panel" onMouseDown={event => event.stopPropagation()}>
      <header className="library-header"><div><span><BookOpen size={20}/></span><div><h2>学习库</h2><p>本机保存的媒体、片段和原文</p></div></div><button onClick={onClose}><X size={19}/></button></header>
      <div className="library-list">{projects.length ? projects.map(project => <article key={project.id} className="library-project">
        <button className="library-project-open" onClick={() => onOpen(project.id)}><span className="library-file"><FileAudio size={21}/></span><div className="library-copy"><b>{project.fileName}</b><span><Clock3 size={12}/>{duration(project.duration)} · {project.segmentCount} 个片段</span><span><Captions size={12}/>{project.cueCount} 条已解析原文</span></div><time>{new Date(project.updatedAt).toLocaleString()}</time></button>
        <div className="library-project-actions"><button onClick={() => onReparse(project.id)}><RefreshCw size={13}/>重新解析</button><button className="danger" onClick={() => onDelete(project.id)}><Trash2 size={13}/>删除</button></div>
      </article>) : <div className="library-empty"><BookOpen size={32}/><b>学习库还是空的</b><p>导入音视频后，程序会自动保存到这里。</p></div>}</div>
      <footer>数据仅保存在当前浏览器中，清除网站数据会同时删除学习库。</footer>
    </section>
  </div>
}
