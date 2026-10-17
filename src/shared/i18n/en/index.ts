import { common } from './common'
import { app } from './app'
import { settings } from './settings'
import { models } from './models'
import { mcp } from './mcp'
import { tasksSettings } from './tasksSettings'
import { misc } from './misc'
import { wizard } from './wizard'
import { chat } from './chat'
import { errors } from './errors'
import { notices } from './notices'
import { main } from './main'
import { mainErrors } from './mainErrors'
import { code } from './code'
import { tasks } from './tasks'
import { tasksComputer } from './tasksComputer'
import { routines } from './routines'
import { browser } from './browser'
import { compare } from './compare'
import { remote } from './remote'
import { mobileShell } from './mobileShell'
import { viewer } from './viewer'
import { memory } from './memory'
import { importSettings } from './importSettings'
import { gallery } from './gallery'

export const en = {
  ...common,
  ...app,
  ...settings,
  ...models,
  ...mcp,
  ...tasksSettings,
  ...misc,
  ...wizard,
  ...chat,
  ...errors,
  ...notices,
  ...main,
  ...mainErrors,
  ...code,
  ...tasks,
  ...tasksComputer,
  ...routines,
  ...browser,
  ...compare,
  ...remote,
  ...mobileShell,
  ...viewer,
  ...memory,
  ...importSettings,
  ...gallery
}

export const AREAS = {
  common,
  app,
  settings,
  models,
  mcp,
  tasksSettings,
  misc,
  wizard,
  chat,
  errors,
  notices,
  main,
  mainErrors,
  code,
  tasks,
  tasksComputer,
  routines,
  browser,
  compare,
  remote,
  mobileShell,
  viewer,
  memory,
  importSettings,
  gallery
}
