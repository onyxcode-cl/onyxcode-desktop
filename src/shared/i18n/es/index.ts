import { common } from './common'
import { app } from './app'
import { settings } from './settings'
import { models } from './models'
import { mcp } from './mcp'
import { tasksSettings } from './tasksSettings'
import { misc } from './misc'
import { wizard } from './wizard'
import { account } from './account'
import { chat } from './chat'
import { errors } from './errors'
import { notices } from './notices'
import { main } from './main'
import { code } from './code'
import { tasks } from './tasks'
import { tasksComputer } from './tasksComputer'
import { routines } from './routines'
import { browser } from './browser'

export const es = {
  ...common,
  ...app,
  ...settings,
  ...models,
  ...mcp,
  ...tasksSettings,
  ...misc,
  ...wizard,
  ...account,
  ...chat,
  ...errors,
  ...notices,
  ...main,
  ...code,
  ...tasks,
  ...tasksComputer,
  ...routines,
  ...browser
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
  account,
  chat,
  errors,
  notices,
  main,
  code,
  tasks,
  tasksComputer,
  routines,
  browser
}
