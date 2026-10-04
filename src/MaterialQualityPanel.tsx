import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LearningCue } from './course'
import { inspectMaterial, prepareCue, qualityPercent, toHiragana } from './materialQuality'

type Props = {
  cues: LearningCue[]
  onChange: (cues: LearningCue[]) => void
  onTranslate: (cueIds: number[], language: 'zh-CN' | 'en') => Promise<void>
  onPrepareReadings: () => Promise<void>
  onClose: () => void
}

export default function MaterialQualityPanel({ cues, onChange, onTranslate, onPrepareReadings, onClose }: Props) {
  const [selectedId, setSelectedId] = useState(cues[0]?.id ?? -1)
  const [translating, setTranslating] = useState('')
  const [translationError, setTranslationError] = useState('')
  const report = useMemo(() => inspectMaterial(cues), [cues])
  const selected = cues.find(cue => cue.id === selectedId)
  const patchSelected = (patch: Partial<LearningCue>) => onChange(cues.map(cue => cue.id === selectedId ? { ...cue, ...patch } : cue))
  const metrics = [
    ['时间轴', report.validTiming], ['自然分词', report.tokenized], ['读音', report.reading],
    ['中文译文', report.chinese], ['英文译文', report.english],
  ] as const
  const translate = async (cueIds: number[], language: 'zh-CN' | 'en', label: string) => {
    setTranslationError('')
    setTranslating(label)
    try { await onTranslate(cueIds, language) }
    catch (error) { setTranslationError(error instanceof Error ? error.message : 'DeepL 翻译失败') }
    finally { setTranslating('') }
  }
  const prepareReadings = async () => {
    setTranslationError('')
    setTranslating('平假名')
    try { await onPrepareReadings() }
    catch (error) { setTranslationError(error instanceof Error ? error.message : '平假名补全失败') }
    finally { setTranslating('') }
  }

  return <div className="material-quality-backdrop" onMouseDown={onClose}>
    <section className="material-quality-panel" onMouseDown={event => event.stopPropagation()}>
      <header><div><small>ECHoloop MATERIAL V2</small><h2>学习素材检查</h2></div><button onClick={onClose} aria-label="关闭"><X/></button></header>
      <div className="material-quality-grid">
        <aside>
          <button className="material-auto" disabled={Boolean(translating)} onClick={() => void prepareReadings()}><Sparkles/>{translating === '平假名' ? '正在分析…' : '自动补全平假名'}</button>
          <div className="material-translate-actions"><button disabled={Boolean(translating)} onClick={() => void translate(cues.filter(cue => !(cue.translations?.['zh-CN'] || cue.translation)).map(cue => cue.id), 'zh-CN', '中文')}>{translating === '中文' ? '翻译中…' : 'DeepL 补全中文'}</button><button disabled={Boolean(translating)} onClick={() => void translate(cues.filter(cue => !cue.translations?.en).map(cue => cue.id), 'en', '英文')}>{translating === '英文' ? '翻译中…' : 'DeepL 补全英文'}</button></div>
          {translationError && <p className="material-translation-error">{translationError}</p>}
          <div className="material-metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}<b>{qualityPercent(value, report.total)}%</b></span><i><em style={{ width: `${qualityPercent(value, report.total)}%` }}/></i></div>)}</div>
          <div className="material-issues">{report.blocking.map(item => <p className="blocking" key={item}>{item}</p>)}{report.warnings.map(item => <p key={item}>{item}</p>)}{!report.blocking.length && !report.warnings.length && <p className="ready"><CheckCircle2/>素材完整，可以导出</p>}</div>
          <div className="material-cue-index">{cues.map((cue, index) => <button className={cue.id === selectedId ? 'active' : ''} key={cue.id} onClick={() => setSelectedId(cue.id)}><b>{index + 1}</b><span>{cue.text}</span></button>)}</div>
        </aside>
        <main>{selected ? <>
          <label>原文<textarea value={selected.text} onChange={event => patchSelected({ text: event.target.value })}/></label>
          <label>整句平假名<input value={selected.reading || toHiragana(selected.readingKatakana || '')} onChange={event => patchSelected({ reading: event.target.value })} placeholder="例：きょうはとうきょうへいきます"/></label>
          <label>中文译文<textarea value={selected.translations?.['zh-CN'] || selected.translation || ''} onChange={event => patchSelected({ translation: event.target.value, translations: { ...selected.translations, 'zh-CN': event.target.value } })}/><button className="material-translate-one" disabled={Boolean(translating)} onClick={() => void translate([selected.id], 'zh-CN', '本句中文')}>DeepL 翻译本句</button></label>
          <label>英文译文<textarea value={selected.translations?.en || ''} onChange={event => patchSelected({ translations: { ...selected.translations, en: event.target.value } })}/><button className="material-translate-one" disabled={Boolean(translating)} onClick={() => void translate([selected.id], 'en', '本句英文')}>DeepL 翻译本句</button></label>
          <div className="material-token-head"><b>自然分词</b><button onClick={() => patchSelected(prepareCue({ ...selected, tokens: [] }))}><Sparkles/>重新分词本句</button></div>
          <div className="material-tokens">{(selected.tokens || []).map((token, index) => <label key={`${token.surface}-${index}`}><span>{token.surface}</span><input value={token.reading || toHiragana(token.readingKatakana || '')} placeholder="平假名" onChange={event => patchSelected({ tokens: selected.tokens?.map((item, tokenIndex) => tokenIndex === index ? { ...item, reading: event.target.value } : item) })}/></label>)}</div>
          <button className="material-from-reading" disabled={!selected.readingKatakana} onClick={() => patchSelected({ reading: toHiragana(selected.readingKatakana || '') })}>转换旧版片假名数据</button>
        </> : <div className="material-empty">请先生成或导入字幕</div>}</main>
      </div>
    </section>
  </div>
}
