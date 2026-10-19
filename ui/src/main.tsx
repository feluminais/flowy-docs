import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './style.css'
import { App } from './App.tsx'
import { startFromSavedState } from './host.ts'
import { followHostTheme } from './hosttheme.ts'

followHostTheme()
startFromSavedState()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
