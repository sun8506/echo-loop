export type StoredSegment = { id: number; start: number; end: number }
export type StoredCue = { id: number; start: number; end: number; text: string; edited?: boolean }

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
  updatedAt: number
}

export type ProjectSummary = Pick<StoredProject, 'id' | 'fileName' | 'fileType' | 'duration' | 'updatedAt'> & {
  segmentCount: number
  cueCount: number
}

const DB_NAME = 'echo-loop-local'
const STORE = 'projects'
const VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('updatedAt', 'updatedAt')
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
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(project)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export async function getLatestProject(): Promise<StoredProject | null> {
  const db = await openDatabase()
  const result = await new Promise<StoredProject | null>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).index('updatedAt').openCursor(null, 'prev')
    request.onsuccess = () => resolve(request.result?.value ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
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
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase()
  const projects = await new Promise<StoredProject[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return projects.sort((a, b) => b.updatedAt - a.updatedAt).map(project => ({
    id: project.id,
    fileName: project.fileName,
    fileType: project.fileType,
    duration: project.duration,
    updatedAt: project.updatedAt,
    segmentCount: project.segments.length,
    cueCount: project.cues.length,
  }))
}
