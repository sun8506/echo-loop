import { isNativeApp } from './runtime'

export type LearnerUser = { id: string; email: string; displayName: string }
export type ServerProgress = {
  courseId: string
  position: number
  speed: number
  completedCueIds: number[]
  bookmarkedCueIds: number[]
  totalSeconds: number
}
export type LearningStats = { totalSeconds: number; courseCount: number; completedCueCount: number }

const configuredApiBase = String(import.meta.env.VITE_LEARNER_API_BASE || '').replace(/\/$/, '')
const API_BASE = configuredApiBase || (isNativeApp ? '' : '/api')
export const TOKEN_KEY = 'echo-loop-learner-token'

export function learnerApiUrl(path: string) {
  if (!API_BASE) throw new Error('当前 App 未配置学习服务器，请使用离线学习或重新配置后构建')
  return `${API_BASE}${path}`
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(learnerApiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || '服务器请求失败')
  return body as T
}

export async function register(email: string, displayName: string, password: string) {
  return request<{ token: string; user: LearnerUser }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, displayName, password }) })
}

export async function login(email: string, password: string) {
  return request<{ token: string; user: LearnerUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export async function getMe(token: string) {
  return request<{ user: LearnerUser }>('/auth/me', {}, token)
}

export async function logout(token: string) {
  return request<{ ok: boolean }>('/auth/logout', { method: 'POST' }, token)
}

export async function getProgress(token: string, courseId: string) {
  return request<ServerProgress>(`/learning/progress/${encodeURIComponent(courseId)}`, {}, token)
}

export async function saveProgress(token: string, courseId: string, progress: Omit<ServerProgress, 'courseId' | 'totalSeconds'> & { learnedSeconds?: number; eventId?: string }) {
  return request<ServerProgress>(`/learning/progress/${encodeURIComponent(courseId)}`, { method: 'POST', body: JSON.stringify(progress) }, token)
}

export async function getStats(token: string) {
  return request<LearningStats>('/learning/stats', {}, token)
}

export async function sendFeedback(token: string, payload: { courseId: string; category: string; message: string; position: number }) {
  return request<{ id: string; status: string }>('/feedback', { method: 'POST', body: JSON.stringify(payload) }, token)
}
