import type { ImportedCoursePackage } from './coursePackage'

const DB_NAME = 'echo-loop-learner'
const STORE = 'courses'
const VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'course.id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveOfflineCourse(course: ImportedCoursePackage): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(course)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

export async function getOfflineCourse(id: string): Promise<ImportedCoursePackage | null> {
  const db = await openDatabase()
  const result = await new Promise<ImportedCoursePackage | null>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}

export async function listOfflineCourses(): Promise<ImportedCoursePackage[]> {
  const db = await openDatabase()
  const result = await new Promise<ImportedCoursePackage[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.importedAt - a.importedAt))
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}
