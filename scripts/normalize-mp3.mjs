#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const audioRoots = [
  resolve(repositoryRoot, 'public/sounds'),
  resolve(repositoryRoot, 'android/app/src/main/res/raw'),
]
const targetLoudness = numericSetting('MP3_TARGET_LUFS', '-16')
const targetLoudnessRange = numericSetting('MP3_TARGET_LRA', '11')
const targetTruePeak = numericSetting('MP3_TARGET_TRUE_PEAK_DB', '-1.5')
const targetSampleRate = integerSetting('MP3_SAMPLE_RATE', '48000')
const targetBitrate = process.env.MP3_BITRATE || '192k'
const dryRun = process.argv.includes('--dry-run')

function numericSetting(name, fallback) {
  const value = process.env[name] || fallback
  if (!Number.isFinite(Number(value))) throw new Error(`${name} must be a number.`)
  return value
}

function integerSetting(name, fallback) {
  const value = numericSetting(name, fallback)
  if (!Number.isInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function printHelp() {
  console.log(`Normalize the app's web and Android MP3 assets.

Usage:
  pnpm audio:normalize [--dry-run]

Environment overrides:
  MP3_TARGET_LUFS          Integrated loudness target (default: -16)
  MP3_TARGET_LRA           Loudness range target (default: 11)
  MP3_TARGET_TRUE_PEAK_DB  True-peak ceiling (default: -1.5)
  MP3_SAMPLE_RATE          Output sample rate (default: 48000)
  MP3_BITRATE              Output bitrate (default: 192k)`)
}

async function collectMp3Files(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectMp3Files(path)
    return entry.isFile() && entry.name.toLowerCase().endsWith('.mp3') ? [path] : []
  }))
  return files.flat()
}

function runFfmpeg(args, capture = false) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error?.code === 'ENOENT') {
    throw new Error('ffmpeg is required. Install it and run the command again.')
  }
  if (result.error) throw result.error
  if (result.status !== 0) {
    const details = capture ? result.stderr.trim() : ''
    throw new Error(details || `ffmpeg exited with status ${result.status}.`)
  }
  return result
}

function analyzeLoudness(input) {
  const filter = [
    `I=${targetLoudness}`,
    `LRA=${targetLoudnessRange}`,
    `TP=${targetTruePeak}`,
    'print_format=json',
  ].join(':')
  const result = runFfmpeg([
    '-loglevel', 'info',
    '-i', input,
    '-map', '0:a:0',
    '-af', `loudnorm=${filter}`,
    '-f', 'null',
    '-',
  ], true)
  const start = result.stderr.lastIndexOf('{')
  const end = result.stderr.indexOf('}', start)
  if (start < 0 || end < 0) throw new Error(`ffmpeg did not return loudness data for ${input}.`)
  const measurement = JSON.parse(result.stderr.slice(start, end + 1))
  const required = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']
  if (required.some(key => !Number.isFinite(Number(measurement[key])))) {
    throw new Error(`Loudness could not be measured for ${input}; verify that it contains audible audio.`)
  }
  return measurement
}

function normalize(input, output, measurement) {
  const filter = [
    `I=${targetLoudness}`,
    `LRA=${targetLoudnessRange}`,
    `TP=${targetTruePeak}`,
    `measured_I=${measurement.input_i}`,
    `measured_TP=${measurement.input_tp}`,
    `measured_LRA=${measurement.input_lra}`,
    `measured_thresh=${measurement.input_thresh}`,
    `offset=${measurement.target_offset}`,
    'linear=true',
    'print_format=summary',
  ].join(':')
  runFfmpeg([
    '-loglevel', 'warning',
    '-i', input,
    '-map', '0:a:0',
    '-map_metadata', '0',
    '-af', `loudnorm=${filter}`,
    '-ar', targetSampleRate,
    '-c:a', 'libmp3lame',
    '-b:a', targetBitrate,
    '-y',
    output,
  ])
  runFfmpeg(['-loglevel', 'error', '-i', output, '-f', 'null', '-'])
}

async function replaceOriginals(normalizedFiles) {
  const replaced = []
  const stagedPaths = []
  try {
    for (const file of normalizedFiles) {
      const stagedPath = `${file.input}.normalize-${process.pid}.tmp.mp3`
      stagedPaths.push(stagedPath)
      await copyFile(file.output, stagedPath)
      await chmod(stagedPath, file.mode)
      await rename(stagedPath, file.input)
      replaced.push(file)
    }
  } catch (error) {
    await Promise.allSettled(replaced.map(async file => {
      await copyFile(file.backup, file.input)
      await chmod(file.input, file.mode)
    }))
    throw error
  } finally {
    await Promise.allSettled(stagedPaths.map(path => rm(path, { force: true })))
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp()
    return
  }
  const unknownArguments = process.argv.slice(2).filter(argument => argument !== '--dry-run')
  if (unknownArguments.length) throw new Error(`Unknown option: ${unknownArguments[0]}`)

  const files = (await Promise.all(audioRoots.map(collectMp3Files))).flat().sort()
  if (!files.length) throw new Error('No source MP3 files were found.')

  console.log(`${dryRun ? 'Would normalize' : 'Normalizing'} ${files.length} MP3 files to ${targetLoudness} LUFS.`)
  if (dryRun) {
    files.forEach(file => console.log(`- ${relative(repositoryRoot, file)}`))
    return
  }

  const workspace = await mkdtemp(join(tmpdir(), 'polymind-normalize-mp3-'))
  const normalizedFiles = []
  try {
    for (const [index, input] of files.entries()) {
      const label = relative(repositoryRoot, input)
      const output = join(workspace, 'normalized', `${index}.mp3`)
      const backup = join(workspace, 'original', `${index}.mp3`)
      const inputStat = await stat(input)
      await mkdir(dirname(output), { recursive: true })
      await mkdir(dirname(backup), { recursive: true })
      await copyFile(input, backup)
      console.log(`[${index + 1}/${files.length}] ${label}`)
      normalize(input, output, analyzeLoudness(input))
      normalizedFiles.push({ input, output, backup, mode: inputStat.mode })
    }
    await replaceOriginals(normalizedFiles)
    console.log(`Normalized ${normalizedFiles.length} MP3 files.`)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(`Audio normalization failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
