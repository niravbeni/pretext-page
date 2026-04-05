import './styles.css'
import {
  prepareWithSegments,
  layoutNextLine,
  walkLineRanges,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext'

// --- Text content matching Simulacra & Simulation p.1 exactly ---

const TITLE_LINE_1 = 'THE PRECESSION'
const TITLE_LINE_2 = 'OF SIMULACRA'

const EPIGRAPH_LINES = [
  'The simulacrum is never what hides the truth\u2014it is truth',
  'that hides the fact that there is none.',
  'The simulacrum is true.',
]
const ATTRIBUTION = '\u2014Ecclesiastes'

const DROP_CAP_CHAR = 'I'

const BODY_PARAGRAPHS = [
  `f once we were able to view the Borges fable in which the cartographers of the Empire draw up a map so detailed that it ends up covering the territory exactly (the decline of the Empire witnesses the fraying of this map, little by little, and its fall into ruins, though some shreds are still discernible in the deserts\u2014the metaphysical beauty of this ruined abstraction testifying to a pride equal to the Empire and rotting like a carcass, returning to the substance of the soil, a bit as the double ends by being confused with the real through aging)\u2014as the most beautiful allegory of simulation, this fable has now come full circle for us, and possesses nothing but the discrete charm of second-order simulacra.\u00B9`,
  `Today abstraction is no longer that of the map, the double, the mirror, or the concept. Simulation is no longer that of a territory, a referential being, or a substance. It is the generation by models of a real without origin or reality: a hyperreal. The territory no longer precedes the map, nor does it survive it. It is nevertheless the map that precedes the territory\u2014precession of simulacra\u2014that engenders the territory, and if one must return to the fable, today it is the territory whose shreds slowly rot across the extent of the map. It is the real, and not the map, whose vestiges persist here and there in the deserts that are no longer those of the Empire, but ours. The desert of the real itself.`,
  `In fact, even inverted, Borges\u2019s fable is unusable. Only the allegory of the Empire, perhaps, remains. Because it is with this same`,
]

// --- Config ---

const BODY_FONT_FAMILY = "'EB Garamond', 'Garamond', 'Palatino Linotype', 'Book Antiqua', Palatino, serif"

const SCAN_COLS = 80
const SCAN_THRESHOLD = 245
const OBSTACLE_H_PAD = 8
const OBSTACLE_MERGE_GAP = 16
const MIN_SLOT_WIDTH = 40

// --- Types ---

type Interval = { left: number; right: number }

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
  slotWidth?: number
  isLastOfParagraph?: boolean
}

// --- DOM refs ---

const page = document.getElementById('page') as HTMLDivElement
const stage = document.getElementById('stage') as HTMLDivElement
const video = document.getElementById('video') as HTMLVideoElement
const sampleCanvas = document.getElementById('sample-canvas') as HTMLCanvasElement
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true })!
const playOverlay = document.getElementById('play-overlay') as HTMLDivElement
const playBtn = document.getElementById('play-btn') as HTMLButtonElement

// --- Measure text width via canvas ---
const measureCanvas = document.createElement('canvas')
const measureCtx = measureCanvas.getContext('2d')!

function measureTextWidth(text: string, font: string): number {
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

// --- Responsive sizing to match book proportions exactly ---

function getPageRect() {
  return page.getBoundingClientRect()
}

function getScaledSizes(pw: number, ph: number) {
  const marginLR = Math.round(pw * 0.12)
  const marginTop = Math.round(ph * 0.12)

  const contentW = pw - marginLR * 2

  const bodySize = Math.round(pw * 0.029)
  const bodyLineHeight = Math.round(bodySize * 1.44)

  const titleSize = Math.round(pw * 0.042)
  const titleLineHeight = Math.round(titleSize * 1.18)
  const titleLetterSpacing = 0.045

  const epigraphSize = Math.round(pw * 0.025)
  const epigraphLineHeight = Math.round(epigraphSize * 1.44)

  const dropCapSize = Math.round(bodyLineHeight * 3 - bodySize * 0.3)

  const paragraphIndent = Math.round(pw * 0.048)

  return {
    bodySize, bodyLineHeight,
    titleSize, titleLineHeight, titleLetterSpacing,
    epigraphSize, epigraphLineHeight,
    dropCapSize,
    marginLR, marginTop,
    contentW,
    paragraphIndent,
  }
}

// --- Obstacle scanning from video ---

function getVideoRect(pageRect: DOMRect): { x: number; y: number; w: number; h: number } {
  const vw = video.videoWidth || 1920
  const vh = video.videoHeight || 1080
  const aspect = vw / vh
  const w = pageRect.width
  const h = w / aspect
  return { x: 0, y: pageRect.height - h, w, h }
}

function scanVideoObstacles(
  videoRect: { x: number; y: number; w: number; h: number },
  bandTop: number,
  bandBottom: number,
): Interval[] {
  if (bandBottom <= videoRect.y || bandTop >= videoRect.y + videoRect.h) return []
  if (!video.videoWidth || (video.paused && video.currentTime === 0)) return []

  const vw = video.videoWidth
  const vh = video.videoHeight
  const scaleY = vh / videoRect.h

  const srcTop = Math.max(0, Math.floor((bandTop - videoRect.y) * scaleY))
  const srcBottom = Math.min(vh, Math.ceil((bandBottom - videoRect.y) * scaleY))
  if (srcBottom <= srcTop) return []

  const scanRows = 3
  sampleCanvas.width = SCAN_COLS
  sampleCanvas.height = scanRows
  sampleCtx.drawImage(video, 0, srcTop, vw, srcBottom - srcTop, 0, 0, SCAN_COLS, scanRows)
  const imgData = sampleCtx.getImageData(0, 0, SCAN_COLS, scanRows).data

  const data = new Uint8Array(SCAN_COLS * 4)
  for (let i = 0; i < SCAN_COLS; i++) {
    let minR = 255, minG = 255, minB = 255
    for (let row = 0; row < scanRows; row++) {
      const idx = (row * SCAN_COLS + i) * 4
      minR = Math.min(minR, imgData[idx]!)
      minG = Math.min(minG, imgData[idx + 1]!)
      minB = Math.min(minB, imgData[idx + 2]!)
    }
    data[i * 4] = minR
    data[i * 4 + 1] = minG
    data[i * 4 + 2] = minB
  }

  const colWidth = videoRect.w / SCAN_COLS
  const intervals: Interval[] = []
  let inBlock = false
  let blockStart = 0

  for (let i = 0; i < SCAN_COLS; i++) {
    const idx = i * 4
    const r = data[idx]!
    const g = data[idx + 1]!
    const b = data[idx + 2]!
    const isDark = r < SCAN_THRESHOLD || g < SCAN_THRESHOLD || b < SCAN_THRESHOLD

    if (isDark && !inBlock) {
      blockStart = i
      inBlock = true
    } else if (!isDark && inBlock) {
      intervals.push({
        left: videoRect.x + blockStart * colWidth - OBSTACLE_H_PAD,
        right: videoRect.x + i * colWidth + OBSTACLE_H_PAD,
      })
      inBlock = false
    }
  }
  if (inBlock) {
    intervals.push({
      left: videoRect.x + blockStart * colWidth - OBSTACLE_H_PAD,
      right: videoRect.x + SCAN_COLS * colWidth + OBSTACLE_H_PAD,
    })
  }

  return mergeIntervals(intervals, OBSTACLE_MERGE_GAP)
}

function mergeIntervals(intervals: Interval[], gap: number = OBSTACLE_MERGE_GAP): Interval[] {
  if (intervals.length <= 1) return intervals
  intervals.sort((a, b) => a.left - b.left)
  const merged: Interval[] = [intervals[0]!]
  for (let i = 1; i < intervals.length; i++) {
    const curr = intervals[i]!
    const prev = merged[merged.length - 1]!
    if (curr.left <= prev.right + gap) {
      prev.right = Math.max(prev.right, curr.right)
    } else {
      merged.push(curr)
    }
  }
  return merged
}

// --- Text line slot carving ---

function carveLineSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots = [base]
  for (const interval of blocked) {
    const next: Interval[] = []
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(s => s.right - s.left >= MIN_SLOT_WIDTH)
}

// --- DOM pool management ---

function syncPool<T extends HTMLElement>(
  pool: T[],
  parent: HTMLElement,
  count: number,
  create: () => T,
): void {
  while (pool.length < count) {
    const el = create()
    parent.appendChild(el)
    pool.push(el)
  }
  for (let i = 0; i < pool.length; i++) {
    pool[i]!.style.display = i < count ? '' : 'none'
  }
}

// --- Render state ---

const bodyLinePool: HTMLSpanElement[] = []
const titleLinePool: HTMLSpanElement[] = []
const epigraphLinePool: HTMLSpanElement[] = []
const attrLinePool: HTMLSpanElement[] = []
let dropCapEl: HTMLSpanElement | null = null

let preparedParagraphs: PreparedTextWithSegments[] = []
let preparedDropCap: PreparedTextWithSegments | null = null
let lastBodyFont = ''
let lastDropCapFont = ''

// --- Main render ---

function render() {
  const pageRect = getPageRect()
  const pw = pageRect.width
  const ph = pageRect.height
  const s = getScaledSizes(pw, ph)

  const bodyFont = `${s.bodySize}px ${BODY_FONT_FAMILY}`
  const titleFont = `500 ${s.titleSize}px ${BODY_FONT_FAMILY}`
  const epigraphFont = `${s.epigraphSize}px ${BODY_FONT_FAMILY}`
  const dropCapFont = `${s.dropCapSize}px ${BODY_FONT_FAMILY}`

  if (bodyFont !== lastBodyFont) {
    preparedParagraphs = BODY_PARAGRAPHS.map(p => prepareWithSegments(p, bodyFont))
    lastBodyFont = bodyFont
  }
  if (dropCapFont !== lastDropCapFont) {
    preparedDropCap = prepareWithSegments(DROP_CAP_CHAR, dropCapFont)
    lastDropCapFont = dropCapFont
  }

  const videoRect = getVideoRect(pageRect)

  // ========== TITLE (centered, two lines) ==========
  let yOffset = s.marginTop

  // Canvas measureText doesn't include CSS letter-spacing, so we must
  // add it manually to get the correct rendered width for centering.
  const lsPx = s.titleLetterSpacing * s.titleSize
  const titleLine1BaseW = measureTextWidth(TITLE_LINE_1, titleFont)
  const titleLine2BaseW = measureTextWidth(TITLE_LINE_2, titleFont)
  const titleLine1W = titleLine1BaseW + (TITLE_LINE_1.length - 1) * lsPx
  const titleLine2W = titleLine2BaseW + (TITLE_LINE_2.length - 1) * lsPx

  const titleLines: PositionedLine[] = [
    {
      x: Math.round((pw - titleLine1W) / 2 - lsPx / 2),
      y: yOffset,
      text: TITLE_LINE_1,
      width: titleLine1W,
    },
    {
      x: Math.round((pw - titleLine2W) / 2 - lsPx / 2),
      y: yOffset + s.titleLineHeight,
      text: TITLE_LINE_2,
      width: titleLine2W,
    },
  ]

  yOffset += s.titleLineHeight * 2 + Math.round(s.titleLineHeight * 1.1)

  syncPool(titleLinePool, stage, titleLines.length, () => {
    const el = document.createElement('span')
    el.className = 'title-line'
    return el
  })
  for (let i = 0; i < titleLines.length; i++) {
    const el = titleLinePool[i]!
    const line = titleLines[i]!
    el.textContent = line.text
    el.style.font = titleFont
    el.style.lineHeight = `${s.titleLineHeight}px`
    el.style.letterSpacing = `${s.titleLetterSpacing}em`
    el.style.left = '0'
    el.style.width = `${pw}px`
    el.style.textAlign = 'center'
    el.style.top = `${line.y}px`
  }

  // ========== EPIGRAPH ==========
  const epigraphInset = Math.round(pw * 0.04)
  const epigraphBaseLeft = s.marginLR + epigraphInset
  const epigraphTabIndent = Math.round(pw * 0.02)
  const epigraphRight = s.marginLR + s.contentW - epigraphInset

  syncPool(epigraphLinePool, stage, EPIGRAPH_LINES.length, () => {
    const el = document.createElement('span')
    el.className = 'epigraph-line'
    return el
  })
  for (let i = 0; i < EPIGRAPH_LINES.length; i++) {
    const el = epigraphLinePool[i]!
    el.textContent = EPIGRAPH_LINES[i]!
    el.style.font = epigraphFont
    el.style.lineHeight = `${s.epigraphLineHeight}px`
    const lineLeft = (i === 0 || i === 2) ? epigraphBaseLeft + epigraphTabIndent : epigraphBaseLeft
    el.style.left = `${lineLeft}px`
    el.style.top = `${yOffset + i * s.epigraphLineHeight}px`
  }
  yOffset += EPIGRAPH_LINES.length * s.epigraphLineHeight + Math.round(s.epigraphLineHeight * 0.15)

  // Attribution right-aligned to the epigraph area
  syncPool(attrLinePool, stage, 1, () => {
    const el = document.createElement('span')
    el.className = 'attribution-line'
    return el
  })
  const attrWidth = measureTextWidth(ATTRIBUTION, epigraphFont)
  const attrEl = attrLinePool[0]!
  attrEl.textContent = ATTRIBUTION
  attrEl.style.font = epigraphFont
  attrEl.style.lineHeight = `${s.epigraphLineHeight}px`
  attrEl.style.left = `${epigraphRight - attrWidth}px`
  attrEl.style.top = `${yOffset}px`

  yOffset += s.epigraphLineHeight + Math.round(s.bodyLineHeight * 0.5)

  // ========== DROP CAP ==========
  let dropCapWidth = 0
  walkLineRanges(preparedDropCap!, 9999, line => {
    dropCapWidth = line.width
  })
  const dropCapGap = Math.round(s.bodySize * 0.2)
  const dropCapTotalW = Math.ceil(dropCapWidth) + dropCapGap
  const dropCapLines = 3
  const dropCapH = dropCapLines * s.bodyLineHeight

  // The top of the drop cap "I" must align with the cap-height/ascender of
  // the first body line. The body text "f" ascender rises above the baseline
  // by roughly bodySize * 0.85. The drop cap glyph itself has internal
  // leading, so we pull it upward by a fraction of its own size to visually
  // align the top of the "I" letterform with the top of "f".
  const dropCapTop = yOffset - Math.round(s.dropCapSize * 0.12)

  if (!dropCapEl) {
    dropCapEl = document.createElement('span')
    dropCapEl.className = 'drop-cap'
    stage.appendChild(dropCapEl)
  }
  dropCapEl.textContent = DROP_CAP_CHAR
  dropCapEl.style.font = dropCapFont
  dropCapEl.style.lineHeight = `${s.dropCapSize}px`
  dropCapEl.style.left = `${s.marginLR}px`
  dropCapEl.style.top = `${dropCapTop}px`

  const dropCapRect = {
    x: s.marginLR,
    y: yOffset,
    w: dropCapTotalW,
    h: dropCapH,
  }

  // ========== BODY TEXT with obstacle avoidance ==========
  const bodyRegionBottom = Math.round(videoRect.y + videoRect.h * 0.65)
  const allBodyLines: PositionedLine[] = []
  let bodyLineTop = yOffset

  for (let pi = 0; pi < preparedParagraphs.length; pi++) {
    const prepared = preparedParagraphs[pi]!
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
    let isFirstLineOfParagraph = true
    let textExhausted = false

    while (bodyLineTop + s.bodyLineHeight <= bodyRegionBottom && !textExhausted) {
      const bandTop = bodyLineTop
      const bandBottom = bodyLineTop + s.bodyLineHeight

      const blocked: Interval[] = []

      if (pi === 0 && bandBottom > dropCapRect.y && bandTop < dropCapRect.y + dropCapRect.h) {
        blocked.push({ left: dropCapRect.x, right: dropCapRect.x + dropCapRect.w })
      }

      const videoBlocked = scanVideoObstacles(videoRect, bandTop, bandBottom)
      blocked.push(...videoBlocked)

      let regionLeft = s.marginLR
      let regionRight = s.marginLR + s.contentW

      if (pi > 0 && isFirstLineOfParagraph) {
        regionLeft += s.paragraphIndent
      }

      const slots = carveLineSlots({ left: regionLeft, right: regionRight }, blocked)

      if (slots.length === 0) {
        bodyLineTop += s.bodyLineHeight
        continue
      }

      const orderedSlots = [...slots].sort((a, b) => a.left - b.left)
      let renderedAnyLine = false

      for (const slot of orderedSlots) {
        const slotWidth = slot.right - slot.left
        const line = layoutNextLine(prepared, cursor, slotWidth)
        if (line === null) {
          textExhausted = true
          break
        }
        const peekNext = layoutNextLine(prepared, line.end, slotWidth)
        const isLast = peekNext === null
        if (isLast) textExhausted = true
        allBodyLines.push({
          x: Math.round(slot.left),
          y: Math.round(bodyLineTop),
          text: line.text,
          width: line.width,
          slotWidth,
          isLastOfParagraph: isLast,
        })
        cursor = line.end
        isFirstLineOfParagraph = false
        renderedAnyLine = true
      }

      if (renderedAnyLine) {
        bodyLineTop += s.bodyLineHeight
      }
    }
  }

  // --- Render body lines (direct left/top, no transitions) ---
  syncPool(bodyLinePool, stage, allBodyLines.length, () => {
    const el = document.createElement('span')
    el.className = 'line'
    return el
  })
  for (let i = 0; i < allBodyLines.length; i++) {
    const el = bodyLinePool[i]!
    const line = allBodyLines[i]!
    el.textContent = line.text
    el.style.left = `${line.x}px`
    el.style.top = `${line.y}px`
    el.style.font = bodyFont
    el.style.lineHeight = `${s.bodyLineHeight}px`

    if (!line.isLastOfParagraph && line.slotWidth && line.width < line.slotWidth) {
      const spaceCount = (line.text.match(/ /g) || []).length
      if (spaceCount > 0) {
        const extra = (line.slotWidth - line.width) / spaceCount
        el.style.wordSpacing = `${extra}px`
      } else {
        el.style.wordSpacing = ''
      }
    } else {
      el.style.wordSpacing = ''
    }
  }
}

// --- Recording ---

const REC_W = 1080
const REC_H = 1920
const recCanvas = document.createElement('canvas')
recCanvas.width = REC_W
recCanvas.height = REC_H
const recCtx = recCanvas.getContext('2d')!

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let isRecording = false

const recordBtn = document.getElementById('record-btn') as HTMLButtonElement
const recordingIndicator = document.createElement('div')
recordingIndicator.id = 'recording-indicator'
recordingIndicator.textContent = 'REC'
recordingIndicator.style.cssText = 'position:fixed;top:16px;right:16px;z-index:200;background:rgba(200,0,0,0.85);color:#fff;font-family:sans-serif;font-size:12px;font-weight:700;padding:4px 10px;border-radius:4px;display:none;letter-spacing:0.05em;'
document.body.appendChild(recordingIndicator)

function drawRecordingFrame() {
  const pageRect = getPageRect()
  const sx = REC_W / pageRect.width
  const sy = REC_H / pageRect.height

  const ctx = recCtx
  ctx.save()

  ctx.fillStyle = '#faf8f4'
  ctx.fillRect(0, 0, REC_W, REC_H)

  const s = getScaledSizes(pageRect.width, pageRect.height)
  const lsPx = s.titleLetterSpacing * s.titleSize

  ctx.scale(sx, sy)
  ctx.fillStyle = '#080808'

  const titleFont = `500 ${s.titleSize}px ${BODY_FONT_FAMILY}`
  const epigraphFont = `${s.epigraphSize}px ${BODY_FONT_FAMILY}`
  const bodyFont = `${s.bodySize}px ${BODY_FONT_FAMILY}`

  // Title
  for (const el of titleLinePool) {
    if (el.style.display === 'none') continue
    ctx.font = titleFont
    ctx.textBaseline = 'top'
    const y = parseFloat(el.style.top)
    const text = el.textContent || ''
    const textW = ctx.measureText(text).width + (text.length - 1) * lsPx
    const x = (pageRect.width - textW) / 2

    let cx = x
    for (let ci = 0; ci < text.length; ci++) {
      ctx.fillText(text[ci]!, cx, y)
      cx += ctx.measureText(text[ci]!).width + lsPx
    }
  }

  // Epigraph
  ctx.font = epigraphFont
  for (const el of epigraphLinePool) {
    if (el.style.display === 'none') continue
    ctx.fillText(el.textContent || '', parseFloat(el.style.left), parseFloat(el.style.top))
  }

  // Attribution
  for (const el of attrLinePool) {
    if (el.style.display === 'none') continue
    ctx.font = epigraphFont
    ctx.fillText(el.textContent || '', parseFloat(el.style.left), parseFloat(el.style.top))
  }

  // Drop cap
  if (dropCapEl) {
    ctx.font = `${s.dropCapSize}px ${BODY_FONT_FAMILY}`
    ctx.fillText(dropCapEl.textContent || '', parseFloat(dropCapEl.style.left), parseFloat(dropCapEl.style.top))
  }

  // Body lines with justification
  ctx.font = bodyFont
  for (const el of bodyLinePool) {
    if (el.style.display === 'none') continue
    const text = el.textContent || ''
    const x = parseFloat(el.style.left)
    const y = parseFloat(el.style.top)
    const ws = parseFloat(el.style.wordSpacing) || 0

    if (ws > 0) {
      const words = text.split(' ')
      let cx = x
      for (let wi = 0; wi < words.length; wi++) {
        ctx.fillText(words[wi]!, cx, y)
        cx += ctx.measureText(words[wi]!).width + ctx.measureText(' ').width + ws
      }
    } else {
      ctx.fillText(text, x, y)
    }
  }

  // Video with multiply blend
  ctx.globalCompositeOperation = 'multiply'
  const videoRect = getVideoRect(pageRect)
  if (video.videoWidth && !video.paused) {
    ctx.drawImage(video, videoRect.x, videoRect.y, videoRect.w, videoRect.h)
  }
  ctx.globalCompositeOperation = 'source-over'

  ctx.restore()
}

function startRecording() {
  recordedChunks = []

  const videoStream = video.captureStream ? video.captureStream() : null
  const audioTracks = videoStream ? videoStream.getAudioTracks() : []
  const canvasStream = recCanvas.captureStream(30)

  if (audioTracks.length > 0) {
    canvasStream.addTrack(audioTracks[0]!)
  }

  const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : MediaRecorder.isTypeSupported('video/webm;codecs=h264')
      ? 'video/webm;codecs=h264'
      : 'video/webm;codecs=vp8'

  mediaRecorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  })

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data)
  }

  mediaRecorder.onstop = () => {
    const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
    const blob = new Blob(recordedChunks, { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulacra-recording.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    recordedChunks = []
  }

  mediaRecorder.start()
  isRecording = true
  recordingIndicator.style.display = 'block'
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  isRecording = false
  recordingIndicator.style.display = 'none'
}

// --- Animation loop ---

let animating = false

function tick() {
  if (!animating) return
  render()
  if (isRecording) drawRecordingFrame()
  requestAnimationFrame(tick)
}

function startAnimation() {
  if (animating) return
  animating = true
  requestAnimationFrame(tick)
}

function stopAnimation() {
  animating = false
}

// --- Init ---

async function init() {
  await document.fonts.ready

  render()

  playBtn.addEventListener('click', () => {
    playOverlay.classList.add('hidden')
    video.play()
    startAnimation()
  })

  recordBtn.addEventListener('click', () => {
    playOverlay.classList.add('hidden')
    video.currentTime = 0
    video.play()
    startAnimation()
    startRecording()
  })

  video.addEventListener('ended', () => {
    if (isRecording) {
      stopRecording()
      video.pause()
      stopAnimation()
      render()
    } else {
      video.currentTime = 0
      video.play()
    }
  })

  video.addEventListener('pause', () => {
    render()
  })

  window.addEventListener('resize', () => {
    lastBodyFont = ''
    lastDropCapFont = ''
    render()
  })

  page.addEventListener('click', (e) => {
    if (e.target === playBtn || e.target === recordBtn) return
    if (playOverlay.classList.contains('hidden')) {
      if (video.paused) {
        video.play()
        startAnimation()
      } else {
        video.pause()
        stopAnimation()
      }
    }
  })
}

init()
