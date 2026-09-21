import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import LearnerApp from './LearnerApp'
import LearnerPortal from './LearnerPortal'
import { isNativeApp } from './runtime'
import './styles.css'
import './interactive.css'
import './transcription.css'
import './library.css'
import './url-import.css'
import './compact-layout.css'
import './learner.css'
import './learner-portal.css'
import './learner-study.css'
import './learner-compact.css'
import './learner-nav.css'
import './learner-layoutfix.css'
import './learner-nav-mobilefix.css'
import './learner-controls.css'
import './material-quality.css'
import './deepl-translation.css'
import './learner-player-layout.css'
import './learner-caption-adaptive.css'

const learnerRoute = isNativeApp || window.location.pathname === '/learn' || window.location.pathname.startsWith('/learn/')
const learnerPortalRoute = isNativeApp
  ? !new URL(window.location.href).searchParams.has('offline')
  : /^\/learn(?:\/(?:courses|materials|vocabulary|profile))?\/?$/.test(window.location.pathname)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{learnerRoute ? (learnerPortalRoute ? <LearnerPortal/> : <LearnerApp/>) : <App/>}</React.StrictMode>,
)
