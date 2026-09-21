export type LearningCue = {
  id: number
  start: number
  end: number
  text: string
  translation?: string
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
