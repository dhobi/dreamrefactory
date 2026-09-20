// WebXR is not in TypeScript's DOM library and `@types/webxr` is not a
// dependency of this repository — this page has no GPU library either, and one
// button is not worth a package. So the slice of the API the bedsit uses is
// declared here, the way `tools/capstone-wasm.d.ts` declares the slice of the
// disassembler the RE tooling uses.
//
// It is deliberately SMALLER than the specification: every member below is one
// this page calls. Hands, hit tests, layers, anchors and the rest of WebXR are
// not here because nothing asks for them, and a declaration nobody exercises is
// a claim about a browser that has never been checked.

interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: XRSessionInit): Promise<XRSession>;
}

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}

interface XRRenderStateInit {
  baseLayer?: XRWebGLLayer;
  /** in METRES, whatever units the content is in — see the scale in bedsit-xr.ts */
  depthNear?: number;
  depthFar?: number;
}

interface XRRenderState {
  readonly baseLayer: XRWebGLLayer | null;
}

interface XRSession extends EventTarget {
  readonly renderState: XRRenderState;
  readonly inputSources: ArrayLike<XRInputSource> & Iterable<XRInputSource>;
  updateRenderState(state: XRRenderStateInit): void;
  requestReferenceSpace(type: string): Promise<XRReferenceSpace>;
  requestAnimationFrame(callback: (time: number, frame: XRFrame) => void): number;
  end(): Promise<void>;
  addEventListener(type: "end", listener: () => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface XRReferenceSpace extends EventTarget {
  getOffsetReferenceSpace(originOffset: XRRigidTransform): XRReferenceSpace;
}

interface XRFrame {
  readonly session: XRSession;
  getViewerPose(space: XRReferenceSpace): XRViewerPose | undefined;
}

interface XRRigidTransform {
  readonly position: DOMPointReadOnly;
  /** column-major, as everything in GL is */
  readonly matrix: Float32Array;
  readonly inverse: XRRigidTransform;
}

interface XRView {
  readonly eye: "left" | "right" | "none";
  readonly projectionMatrix: Float32Array;
  readonly transform: XRRigidTransform;
}

interface XRViewerPose {
  readonly transform: XRRigidTransform;
  readonly views: readonly XRView[];
}

interface XRViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface XRWebGLLayerInit {
  antialias?: boolean;
  depth?: boolean;
  framebufferScaleFactor?: number;
}

declare class XRWebGLLayer {
  constructor(session: XRSession, context: WebGLRenderingContext | WebGL2RenderingContext, init?: XRWebGLLayerInit);
  /** NOT `null`: this is what the room must be drawn into while a session runs */
  readonly framebuffer: WebGLFramebuffer;
  readonly framebufferWidth: number;
  readonly framebufferHeight: number;
  getViewport(view: XRView): XRViewport | undefined;
}

interface XRInputSource {
  readonly handedness: "none" | "left" | "right";
  readonly targetRayMode: string;
  readonly gamepad: Gamepad | null;
}

interface Navigator {
  /** absent in every browser without a headset behind it, and on plain http */
  readonly xr?: XRSystem;
}

interface WebGLRenderingContext {
  makeXRCompatible(): Promise<void>;
}

interface WebGLContextAttributes {
  /** ask for the context on whichever GPU drives a headset, if there is one */
  xrCompatible?: boolean;
}
