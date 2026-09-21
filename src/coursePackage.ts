import { strFromU8, strToU8, unzip, zip } from 'fflate'
import type { LearningCue, LearningCourse } from './course'

export const COURSE_PACKAGE_EXTENSION = '.echoloop'
export const MAX_COURSE_PACKAGE_BYTES = 800 * 1024 * 1024

export type CoursePackageManifest = {
  format: 'echoloop-course'
  version: 1
  id: string
  title: string
  description: string
  language: string
  duration: number
  exportedAt: string
  media: { file: string; type: string; size: number }
  cues: LearningCue[]
  segments: Array<{ id: number; start: number; end: number }>
}

export type ImportedCoursePackage = {
  course: Omit<LearningCourse, 'mediaUrl'>
  media: Blob
  importedAt: number
}

const safeName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 90) || 'EchoLoop学习素材'

export function exportCoursePackage(input: {
  id: string
  title: string
  description?: string
  language?: string
  duration: number
  media: Blob
  mediaName: string
  mediaType: string
  cues: LearningCue[]
  segments: Array<{ id: number; start: number; end: number }>
}): Promise<{ blob: Blob; fileName: string }> {
  const extension = input.mediaName.match(/\.[A-Za-z0-9]{1,8}$/)?.[0]?.toLowerCase() || '.bin'
  const mediaPath = `media/source${extension}`
  const manifest: CoursePackageManifest = {
    format: 'echoloop-course',
    version: 1,
    id: input.id || crypto.randomUUID(),
    title: input.title || input.mediaName.replace(/\.[^.]+$/, ''),
    description: input.description || '',
    language: input.language || '',
    duration: input.duration,
    exportedAt: new Date().toISOString(),
    media: { file: mediaPath, type: input.mediaType || 'application/octet-stream', size: input.media.size },
    cues: input.cues,
    segments: input.segments,
  }
  return input.media.arrayBuffer().then(buffer => new Promise((resolve, reject) => {
    zip({
      'manifest.json': [strToU8(JSON.stringify(manifest)), { level: 6 }],
      [mediaPath]: [new Uint8Array(buffer), { level: 0 }],
    }, { level: 0 }, (error, data) => {
      if (error) return reject(error)
      resolve({ blob: new Blob([data], { type: 'application/vnd.echoloop.course+zip' }), fileName: `${safeName(manifest.title)}${COURSE_PACKAGE_EXTENSION}` })
    })
  }))
}

export async function importCoursePackage(file: File): Promise<ImportedCoursePackage> {
  if (!file.size || file.size > MAX_COURSE_PACKAGE_BYTES) throw new Error('学习包为空或超过 800MB 限制')
  let archive: Record<string, Uint8Array>
  try {
    archive = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      file.arrayBuffer().then(buffer => unzip(new Uint8Array(buffer), (error, data) => error ? reject(error) : resolve(data))).catch(reject)
    })
  } catch {
    throw new Error('所选文件不是有效的 EchoLoop 学习包')
  }
  const manifestBytes = archive['manifest.json']
  if (!manifestBytes || manifestBytes.byteLength > 5 * 1024 * 1024) throw new Error('素材清单缺失或异常')
  let manifest: CoursePackageManifest
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as CoursePackageManifest
  } catch {
    throw new Error('素材清单无法读取')
  }
  if (manifest.format !== 'echoloop-course' || manifest.version !== 1) throw new Error('不支持的学习包版本')
  if (!manifest.id || !manifest.title || !Number.isFinite(manifest.duration) || !Array.isArray(manifest.cues)) throw new Error('素材资料不完整')
  const mediaBytes = archive[manifest.media?.file]
  if (!mediaBytes || !mediaBytes.byteLength) throw new Error('学习包中没有媒体文件')
  if (manifest.media.size && manifest.media.size !== mediaBytes.byteLength) throw new Error('素材媒体校验失败')
  const cues = manifest.cues.filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && typeof cue.text === 'string')
  const mediaCopy = new Uint8Array(mediaBytes.byteLength)
  mediaCopy.set(mediaBytes)
  return {
    course: {
      id: `offline:${manifest.id}`,
      title: manifest.title,
      description: manifest.description,
      language: manifest.language,
      mediaType: manifest.media.type,
      duration: manifest.duration,
      cues,
    },
    media: new Blob([mediaCopy.buffer], { type: manifest.media.type }),
    importedAt: Date.now(),
  }
}
