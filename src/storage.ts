export type StoredSegment = { id: number; start: number; end: number }
import type { LearningCue } from './course'

export type StoredCue = LearningCue & { edited?: boolean }

export type AnalysisRecord = {
  id: string
  name: string
  scope: 'full' | 'range'
  start: number
  end: number
  model: 'silence' | 'whisperx' | 'nvidia'
  dedupeKey: string
  status: 'running' | 'ready' | 'error'
  createdAt: number
  completedAt?: number
  segments?: StoredSegment[]
  cues?: StoredCue[]
  detectedLanguage?: string
}

export type AnalysisSummary = Omit<AnalysisRecord, 'segments' | 'cues'> & { cueCount: number }

export type PublicationDraft = {
  status: 'draft' | 'published'
  visibility: 'private' | 'global' | 'selected'
  allowedEmails: string[]
  expiresAt?: string
  serverCourseId?: string
  publishedAt?: number
}

export type VideoMask = { enabled: boolean; x: number; y: number; width: number; height: number }

export type StoredProject = {
  id: string
  fileName: string
  fileType: string
  lastModified: number
  media: Blob
  duration: number
  waveform: number[]
  segments: StoredSegment[]
  cues: StoredCue[]
  selectedIds: number[]
  range: [number, number]
  detectedLanguage: string
  analyses?: AnalysisRecord[]
  publication?: PublicationDraft
  videoMask?: VideoMask
  updatedAt: number
}

export type ProjectSummary = Pick<StoredProject, 'id' | 'fileName' | 'fileType' | 'duration' | 'updatedAt' | 'range'> & {
  segmentCount: number
  cueCount: number
  analyses: AnalysisSummary[]
  publication?: PublicationDraft
  readyAnalysisCount: number
  runningAnalysisCount: number
  isLearnable: boolean
}

const DB_NAME = 'echo-loop-local'
const STORE = 'projects'
const SUMMARY_STORE = 'project-summaries'
const VERSION = 2

function toSummary(project: StoredProject): ProjectSummary {
  const records = project.analyses || []
  const analyses = records.map(({ segments: _segments, cues, ...item }) => ({ ...item, cueCount: cues?.length || 0 }))
  return {
    id: project.id,
    fileName: project.fileName,
    fileType: project.fileType,
    duration: project.duration,
    updatedAt: project.updatedAt,
    segmentCount: project.segments?.length || 0,
    cueCount: project.cues?.length || 0,
    range: project.range || [0, project.duration || 0],
    analyses,
    publication: project.publication,
    readyAnalysisCount: records.filter(item => item.status === 'ready').length,
    runningAnalysisCount: records.filter(item => item.status === 'running').length,
    isLearnable: (project.cues?.length || 0) > 0 && (!records.length || records.some(item => item.status === 'ready')),
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = event => {
      const db = request.result
      const projectStore = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' })
      if (!projectStore.indexNames.contains('updatedAt')) projectStore.createIndex('updatedAt', 'updatedAt')
      const summaryStore = db.objectStoreNames.contains(SUMMARY_STORE)
        ? request.transaction!.objectStore(SUMMARY_STORE)
        : db.createObjectStore(SUMMARY_STORE, { keyPath: 'id' })
      if (!summaryStore.indexNames.contains('updatedAt')) summaryStore.createIndex('updatedAt', 'updatedAt')
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        const cursor = projectStore.openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) return
          summaryStore.put(toSummary(row.value as StoredProject))
          row.continue()
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const projectIdFor = (file: File) => `${file.name}:${file.size}:${file.lastModified}`

export async function saveProject(project: StoredProject) {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, SUMMARY_STORE], 'readwrite')
    transaction.objectStore(STORE).put(project)
    transaction.objectStore(SUMMARY_STORE).put(toSummary(project))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export async function getProject(id: string): Promise<StoredProject | null> {
  const db = await openDatabase()
  const result = await new Promise<StoredProject | null>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, SUMMARY_STORE], 'readwrite')
    transaction.objectStore(STORE).delete(id)
    transaction.objectStore(SUMMARY_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase()
  const summaries = await new Promise<ProjectSummary[]>((resolve, reject) => {
    const request = db.transaction(SUMMARY_STORE, 'readonly').objectStore(SUMMARY_STORE).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}
