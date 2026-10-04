import { useEffect, useState } from 'react'
import { Sparkles, Upload } from 'lucide-react'
import type { AnalysisRecord, PublicationDraft, VideoMask } from './storage'

type Props = {
  hasMedia: boolean; hasResult: boolean; busy: boolean; publishing: boolean
  duration: number; range: [number, number]; model: string
  name: string; scope: 'full' | 'range'; analyses: AnalysisRecord[]; publication: PublicationDraft
  visibility: 'private' | 'global' | 'selected'; emails: string; expiry: string
  videoMask: VideoMask; isAudio: boolean
  onName: (value: string) => void; onScope: (value: 'full' | 'range') => void
  onRange: (value: [number, number]) => void
  onVisibility: (value: 'private' | 'global' | 'selected') => void
  onEmails: (value: string) => void; onExpiry: (value: string) => void
  onVideoMask: (value: VideoMask) => void
  onAnalyze: (range: [number, number]) => void; onPublish: () => void
}
const stamp = (value: number) => {
  const seconds = Math.max(0, Math.floor(value || 0))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')
  const rest = (seconds % 60).toString().padStart(2, '0')
  return hours ? `${hours}:${minutes}:${rest}` : `${Number(minutes)}:${rest}`
}
const parseStamp = (value: string) => {
  const parts = value.trim().split(':').map(Number)
  if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return NaN
  if (parts.length > 1 && parts.slice(1).some(part => part >= 60)) return NaN
  return parts.reduce((total, part) => total * 60 + part, 0)
}
export default function WorkflowPanel(props: Props) {
  const [startText, setStartText] = useState(stamp(props.range[0]))
  const [endText, setEndText] = useState(stamp(props.range[1]))
  const [rangeError, setRangeError] = useState('')
  useEffect(() => { setStartText(stamp(props.range[0])); setEndText(stamp(props.range[1])) }, [props.range[0], props.range[1]])
  const resolveRange = (): [number, number] | null => {
    const start = parseStamp(startText), end = parseStamp(endText)
    if (!Number.isFinite(start) || !Number.isFinite(end)) { setRangeError('请输入 H:MM:SS、MM:SS 或秒数'); return null }
    if (end <= start) { setRangeError('结束时间必须晚于开始时间'); return null }
    if (props.duration && end > props.duration + .5) { setRangeError(`结束时间不能超过素材时长 ${stamp(props.duration)}`); return null }
    setRangeError(''); const value: [number, number] = [start, end]; props.onRange(value); return value
  }
  const analyze = () => {
    const selected = props.scope === 'full' ? [0, props.duration] as [number, number] : resolveRange()
    if (selected) props.onAnalyze(selected)
  }
  return <section className="workflow-panel">
    <div className="workflow-step"><span>01</span><div><b>素材记录</b><small>{props.hasMedia ? '已登记，本机保存；不会自动解析' : '等待登记音视频'}</small></div></div>
    <div className="workflow-step workflow-form"><span>02</span><div><b>解析任务</b><div className="workflow-fields"><input value={props.name} onChange={event => props.onName(event.target.value)} placeholder="解析流程名称"/><select value={props.scope} onChange={event => props.onScope(event.target.value as 'full' | 'range')}><option value="full">全素材</option><option value="range">指定时间段</option></select>{props.scope === 'range' && <div className="workflow-time-range"><label>开始<input inputMode="numeric" value={startText} onChange={event => setStartText(event.target.value)} onBlur={resolveRange} placeholder="1:08:10"/></label><i>—</i><label>结束<input inputMode="numeric" value={endText} onChange={event => setEndText(event.target.value)} onBlur={resolveRange} placeholder="1:10:20"/></label></div>}<button disabled={!props.hasMedia || props.busy} onClick={analyze}><Sparkles/>{props.busy ? '解析中…' : '开始解析'}</button></div>{rangeError && <em className="workflow-error">{rangeError}</em>}<small>模型：{props.model}；指定区间时只裁剪和解析该部分，其他内容不处理。</small></div></div>
    <div className="workflow-step workflow-form"><span>03</span><div><b>暂存与发布</b><div className="workflow-fields"><select value={props.visibility} onChange={event => props.onVisibility(event.target.value as 'private' | 'global' | 'selected')}><option value="private">私有暂存（不开放）</option><option value="global">全局用户</option><option value="selected">指定用户</option></select>{props.visibility === 'selected' && <input value={props.emails} onChange={event => props.onEmails(event.target.value)} placeholder="用户邮箱，逗号分隔"/>}<input type="date" value={props.expiry} onChange={event => props.onExpiry(event.target.value)}/><button disabled={!props.hasResult || props.publishing} onClick={props.onPublish}><Upload/>{props.publishing ? '裁剪上传中…' : '发布解析区间'}</button></div>{!props.isAudio&&<div className="video-mask-fields"><label><input type="checkbox" checked={props.videoMask.enabled} onChange={event=>props.onVideoMask({...props.videoMask,enabled:event.target.checked})}/>遮挡指定区域</label>{props.videoMask.enabled&&<><button type="button" onClick={()=>props.onVideoMask({enabled:true,x:0,y:0,width:24,height:14})}>左上角</button>{(['x','y','width','height'] as const).map(key=><label key={key}>{({x:'左',y:'上',width:'宽',height:'高'} as const)[key]}%<input type="number" min="0" max="100" value={props.videoMask[key]} onChange={event=>props.onVideoMask({...props.videoMask,[key]:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label>)}</>}</div>}<small>仅上传 {stamp(props.range[0])}–{stamp(props.range[1])} 的媒体片段；{props.videoMask.enabled&&!props.isAudio?'发布时会写入遮挡区域；':''}完整原素材不上传。{props.publication.status === 'published' && ` 已发布：/learn/${props.publication.serverCourseId}`}</small></div></div>
    {props.analyses.length > 0 && <div className="workflow-jobs">{props.analyses.slice(0, 4).map(item => <span key={item.id}><b>{item.name}</b> · {item.scope === 'full' ? '全素材' : `${stamp(item.start)}–${stamp(item.end)}`} · {item.status === 'ready' ? '已暂存' : item.status === 'running' ? '解析中' : '失败'}</span>)}</div>}
  </section>
}
