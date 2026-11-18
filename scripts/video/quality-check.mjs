#!/usr/bin/env node
/** Offline calibration using the same thumbnail comparison as cuadros/render. No app or user profile. */
import { spawnSync } from 'node:child_process'
import { measureMotion } from '../../resources/video/inspect-frame.mjs'
const ffmpeg = process.env.VIDEO_FFMPEG ?? 'ffmpeg'
const ffprobe = process.env.VIDEO_FFPROBE ?? 'ffprobe'
for (const file of process.argv.slice(2)) {
  const meta = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', timeout: 15000 })
  const duration = Number(meta.stdout)
  if (meta.status !== 0 || !Number.isFinite(duration) || duration <= 0 || duration > 120) throw Error('Duración inválida')
  const frames = spawnSync(ffmpeg, ['-v', 'error', '-threads', '1', '-i', file, '-vf', 'fps=4,scale=64:64', '-pix_fmt', 'gray', '-f', 'rawvideo', '-threads', '1', 'pipe:1'], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 })
  if (frames.status !== 0) throw Error('No se pudieron muestrear los cuadros')
  const bytes = Buffer.concat([frames.stdout, frames.stdout.subarray(-4096)])
  console.log(JSON.stringify({ archivo: file, ...measureMotion(bytes, duration) }))
}
