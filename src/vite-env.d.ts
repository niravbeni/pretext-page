/// <reference types="vite/client" />

interface HTMLVideoElement {
  captureStream(): MediaStream
}

interface HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream
}
