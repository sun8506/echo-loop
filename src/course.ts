export type LearningToken = {
  surface: string
  reading?: string
  readingKatakana?: string
  baseForm?: string
  partOfSpeech?: string
  meanings?: Record<string, string>
}

export type LearningCue = {
  id: number
  start: number
  end: number
  text: string
  translation?: string
  translations?: Record<string, string>
  reading?: string
  readingKatakana?: string
  tokens?: LearningToken[]
}

export type LearningCourse = {
  id: string
  title: string
  description?: string
  language?: string
  level?: string
  mediaUrl: string
  mediaType: string
  duration: number
  cues: LearningCue[]
}

export type LearningProgress = {
  position: number
  completedCueIds: number[]
  speed: number
  bookmarkedCueIds?: number[]
  totalSeconds?: number
  updatedAt: number
}
