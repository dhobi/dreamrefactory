/**
 * A film written out as a video file (#435) — the browser half of
 * engine/src/df/mov-film.ts, which says what is on screen when and what plays
 * under it. This draws those frames, encodes them with the browser's own
 * encoders (WebCodecs) and puts them in a file with Mediabunny; nothing leaves
 * the page.
 *
 * MP4 with H.264 where the browser can encode it, with AAC sound where it has
 * that and Opus where it does not (Chromium on Linux ships no AAC encoder);
 * WebM with VP9 or VP8 otherwise. Each frame goes in for exactly as long as the
 * film holds it, so the video carries the film's own uneven timing rather than
 * a frame rate of its own.
 *
 * The picture is scaled up by a whole number with no smoothing — a 512×384 film
 * comes out 1024×768 — because players blur a small video when they fill a
 * screen with it, and pixel art blurred is not the film.
 */
import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { MovFile } from "@dreamfactory/engine/df/mov";
import { FilmPictures, FilmTimeline, filmTimeline, mixFilmSound } from "@dreamfactory/engine/df/mov-film";

/** the sample rate both audio encoders take */
const RATE = 48000;
/** scale the picture up until it is at least this tall, by a whole number */
const TARGET_HEIGHT = 720;

export interface FilmVideo {
  blob: Blob;
  extension: string;
  /** what went in, e.g. "H.264 + AAC" */
  codecs: string;
  width: number;
  height: number;
  timeline: FilmTimeline;
}

const NAMES: Record<string, string> = { avc: "H.264", vp9: "VP9", vp8: "VP8", aac: "AAC", opus: "Opus" };

/** null when this browser can encode no video at all */
export async function encodeFilmVideo(
  mov: MovFile,
  fallback: { width: number; height: number },
  onProgress: (fraction: number) => void,
): Promise<FilmVideo | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const timeline = filmTimeline(mov);
  const pictures = new FilmPictures(mov);

  // the video's size is its first picture's, as every frame of a shipped film is
  const first = timeline.shots[0];
  const firstPic = first ? pictures.picture(first.segIdx, first.frame) : null;
  const srcW = firstPic?.width || fallback.width;
  const srcH = firstPic?.height || fallback.height;
  const scale = Math.max(1, Math.ceil(TARGET_HEIGHT / srcH));
  // H.264 wants even sides
  const width = (srcW * scale + 1) & ~1;
  const height = (srcH * scale + 1) & ~1;

  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
  let video = await getFirstEncodableVideoCodec(["avc"], { width, height, quality: QUALITY_HIGH });
  if (!video) {
    format = new WebMOutputFormat();
    video = await getFirstEncodableVideoCodec(["vp9", "vp8"], { width, height, quality: QUALITY_HIGH });
  }
  if (!video) return null;
  const pcm = mixFilmSound(timeline, RATE);
  const audible = pcm.some((s) => s !== 0);
  const audio = audible
    ? await getFirstEncodableAudioCodec(format instanceof Mp4OutputFormat ? ["aac", "opus"] : ["opus"], {
        numberOfChannels: 1,
        sampleRate: RATE,
        quality: QUALITY_HIGH,
      })
    : null;

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const small = new OffscreenCanvas(srcW, srcH);
  const smallCtx = small.getContext("2d")!;

  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: video, quality: QUALITY_HIGH });
  output.addVideoTrack(videoSource);
  const audioSource = audio ? new AudioSampleSource({ codec: audio, quality: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  for (let i = 0; i < timeline.shots.length; i++) {
    const shot = timeline.shots[i];
    const pic = pictures.picture(shot.segIdx, shot.frame);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    if (pic) {
      if (small.width !== pic.width || small.height !== pic.height) {
        small.width = pic.width;
        small.height = pic.height;
      }
      smallCtx.putImageData(new ImageData(new Uint8ClampedArray(pic.rgba), pic.width, pic.height), 0, 0);
      // a frame of another size sits centred, at the same scale
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        small,
        Math.round((width - pic.width * scale) / 2),
        Math.round((height - pic.height * scale) / 2),
        pic.width * scale,
        pic.height * scale,
      );
    }
    await videoSource.add(shot.atMs / 1000, shot.ms / 1000);
    onProgress(((i + 1) / timeline.shots.length) * (audioSource ? 0.9 : 1));
  }
  videoSource.close();

  if (audioSource) {
    // a second at a time, so no one sample is the whole film
    for (let at = 0; at < pcm.length; at += RATE) {
      const data = pcm.slice(at, at + RATE);
      const sample = new AudioSample({ data, format: "f32", numberOfChannels: 1, sampleRate: RATE, timestamp: at / RATE });
      await audioSource.add(sample);
      sample.close();
    }
    audioSource.close();
  }
  await output.finalize();
  onProgress(1);

  const buffer = (output.target as BufferTarget).buffer!;
  return {
    blob: new Blob([buffer], { type: format.mimeType }),
    extension: format.fileExtension,
    codecs: NAMES[video] + (audio ? ` + ${NAMES[audio]}` : ""),
    width,
    height,
    timeline,
  };
}
