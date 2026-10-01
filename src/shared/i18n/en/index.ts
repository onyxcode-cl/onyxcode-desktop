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

export const en = {
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
}

export const AREAS = { common, app, settings, models, mcp, tasksSettings, misc, wizard, account, chat, errors, notices, main }
