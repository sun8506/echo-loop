import type { LearningCue, LearningToken } from './course'

const WORDS_KEY = 'echo-loop-wordbook-v1'
const SENTENCES_KEY = 'echo-loop-sentencebook-v1'

export type SavedWord = LearningToken & { id: string; courseId: string; courseTitle: string; cueId: number; savedAt: number }
export type SavedSentence = { id: string; courseId: string; courseTitle: string; cue: LearningCue; savedAt: number }

function read<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function write<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function saveWord(word: LearningToken, courseId: string, courseTitle: string, cueId: number) {
  const items = read<SavedWord>(WORDS_KEY)
  const id = `${courseId}:${word.baseForm || word.surface}`
  if (!items.some(item => item.id === id)) write(WORDS_KEY, [{ ...word, id, courseId, courseTitle, cueId, savedAt: Date.now() }, ...items])
}

export function saveSentence(cue: LearningCue, courseId: string, courseTitle: string) {
  const items = read<SavedSentence>(SENTENCES_KEY)
  const id = `${courseId}:${cue.id}`
  if (!items.some(item => item.id === id)) write(SENTENCES_KEY, [{ id, courseId, courseTitle, cue, savedAt: Date.now() }, ...items])
}

export const getSavedWords = () => read<SavedWord>(WORDS_KEY)
export const getSavedSentences = () => read<SavedSentence>(SENTENCES_KEY)

export function removeSavedWord(id: string) {
  write(WORDS_KEY, read<SavedWord>(WORDS_KEY).filter(item => item.id !== id))
}

export function removeSavedSentence(id: string) {
  write(SENTENCES_KEY, read<SavedSentence>(SENTENCES_KEY).filter(item => item.id !== id))
}

export function segmentJapanese(text: string): LearningToken[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'word' }) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter
  if (!Segmenter) return [...text].map(surface => ({ surface }))
  return [...new Segmenter('ja', { granularity: 'word' }).segment(text)].map(item => ({ surface: item.segment }))
}
