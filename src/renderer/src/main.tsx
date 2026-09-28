import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_NAME } from '@shared/brand'
import { App } from './app/App'
import './app/globals.css'

document.title = APP_NAME

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
