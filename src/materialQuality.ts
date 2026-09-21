import type { LearningCue, LearningToken } from './course'

export type MaterialQuality = {
  total: number
  validTiming: number
  tokenized: number
  reading: number
  chinese: number
  english: number
  blocking: string[]
  warnings: string[]
}

export const toKatakana = (value: string) => [...value].map(character => {
  const code = character.charCodeAt(0)
  return code >= 0x3041 && code <= 0x3096 ? String.fromCharCode(code + 0x60) : character
}).join('')

export const toHiragana = (value: string) => [...value].map(character => {
  const code = character.charCodeAt(0)
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : character
}).join('')

export function tokenizeJapanese(text: string): LearningToken[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter
  const pieces = Segmenter
    ? [...new Segmenter('ja', { granularity: 'word' }).segment(text)].map(item => ({ surface: item.segment, word: item.isWordLike !== false }))
    : [...text].map(surface => ({ surface, word: /[\p{L}\p{N}]/u.test(surface) }))
  return pieces.map(item => {
    const kanaOnly = item.word && /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(item.surface)
    return {
      surface: item.surface,
      ...(kanaOnly ? { reading: item.surface, readingKatakana: toKatakana(item.surface) } : {}),
    }
  })
}

export function prepareCue(cue: LearningCue): LearningCue {
  return { ...cue, tokens: cue.tokens?.length ? cue.tokens : tokenizeJapanese(cue.text) }
}

export function inspectMaterial(cues: LearningCue[]): MaterialQuality {
  const total = cues.length
  const validTiming = cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text.trim()).length
  const tokenized = cues.filter(cue => cue.tokens?.some(token => /[\p{L}\p{N}]/u.test(token.surface))).length
  const reading = cues.filter(cue => Boolean(cue.readingKatakana || cue.reading || cue.tokens?.some(token => token.readingKatakana || token.reading))).length
  const chinese = cues.filter(cue => Boolean(cue.translations?.['zh-CN'] || cue.translation)).length
  const english = cues.filter(cue => Boolean(cue.translations?.en)).length
  const blocking: string[] = []
  const warnings: string[] = []
  if (!total) blocking.push('没有可导出的字幕')
  if (validTiming < total) blocking.push(`${total - validTiming} 句的时间轴或原文无效`)
  if (tokenized < total) warnings.push(`${total - tokenized} 句尚未进行自然分词`)
  if (reading < total) warnings.push(`${total - reading} 句缺少读音/片假名`)
  if (chinese < total) warnings.push(`${total - chinese} 句缺少中文译文`)
  if (english < total) warnings.push(`${total - english} 句缺少英文译文`)
  return { total, validTiming, tokenized, reading, chinese, english, blocking, warnings }
}

export const qualityPercent = (value: number, total: number) => total ? Math.round(value / total * 100) : 0
