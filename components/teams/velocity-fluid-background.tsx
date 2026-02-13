"use client"

/*
 * WebGL2 Velocity Vector Field Visualization
 * Navier-Stokes fluid sim matching gpu-io/examples/fluid exactly.
 * Pipeline: advect → curl → vorticity → divergence → jacobi pressure → gradient subtract.
 * Very gentle vorticity confinement (CURL=0.2) sustains ambient flow.
 * Velocity in canvas-pixel units, REPEAT wrap, float32 textures.
 * Rendered as GL_LINES vector field (gpu-io "Velocity" mode).
 */

import { useEffect, useRef } from "react"

interface VelocityFluidBackgroundProps {
  className?: string
}

export function VelocityFluidBackground({ className }: VelocityFluidBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const canvas = canvasEl

    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight

    // ── Config — matching repo constants exactly ──
    const VELOCITY_SCALE_FACTOR = 8
    const NUM_JACOBI_STEPS = 3
    const PRESSURE_CALC_ALPHA = -1
    const PRESSURE_CALC_BETA = 0.25
    const MAX_VELOCITY = 30
    const SPLAT_RADIUS = 0.0025
    const SPLAT_FORCE = 800
    const VECTOR_SPACING = 10
    const VECTOR_SCALE = 2.5
    // Vorticity confinement — helps sustain rotational flow between auto-splats
    const CURL = 0.4
    // Auto-splat: inject gentle ambient splats periodically to keep the field alive
    // (both repos decay to zero without user interaction — this keeps it animated)
    const AUTO_SPLAT_INTERVAL = 90  // frames (~1.5s at 60fps)
    const AUTO_SPLAT_COUNT = 3
    const AUTO_SPLAT_STRENGTH = 8   // much gentler than MAX_VELOCITY=30

    class Pointer {
      id = -1; texcoordX = 0; texcoordY = 0
      prevTexcoordX = 0; prevTexcoordY = 0
      deltaX = 0; deltaY = 0
      down = false; moved = false
    }

    const pointers: Pointer[] = [new Pointer()]
    const splatStack: number[] = []

    // ── WebGL2 Context ──
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    const gl = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null
    if (!gl) return
    const g = gl

    g.getExtension("EXT_color_buffer_float")
    g.getExtension("OES_texture_float_linear")
    g.clearColor(0.0, 0.0, 0.0, 1.0)

    // ── Shader helpers ──
    function compileShader(type: number, source: string) {
      const shader = g.createShader(type)!
      g.shaderSource(shader, source)
      g.compileShader(shader)
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS))
        console.trace(g.getShaderInfoLog(shader))
      return shader
    }

    function getUniforms(program: WebGLProgram) {
      const uniforms: Record<string, WebGLUniformLocation | null> = {}
      const count = g.getProgramParameter(program, g.ACTIVE_UNIFORMS)
      for (let i = 0; i < count; i++) {
        const name = g.getActiveUniform(program, i)!.name
        uniforms[name] = g.getUniformLocation(program, name)
      }
      return uniforms
    }

    class Program {
      uniforms: Record<string, WebGLUniformLocation | null>
      program: WebGLProgram
      constructor(vs: WebGLShader, fs: WebGLShader) {
        this.program = g.createProgram()!
        g.attachShader(this.program, vs)
        g.attachShader(this.program, fs)
        g.linkProgram(this.program)
        if (!g.getProgramParameter(this.program, g.LINK_STATUS))
          console.trace(g.getProgramInfoLog(this.program))
        this.uniforms = getUniforms(this.program)
      }
      bind() { g.useProgram(this.program) }
    }

    // ── VAOs ──
    const quadVAO = g.createVertexArray()!
    g.bindVertexArray(quadVAO)
    const quadBuffer = g.createBuffer()!
    const quadIndexBuffer = g.createBuffer()!
    g.bindBuffer(g.ARRAY_BUFFER, quadBuffer)
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW)
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, quadIndexBuffer)
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW)
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
    g.enableVertexAttribArray(0)
    g.bindVertexArray(null)

    const emptyVAO = g.createVertexArray()!

    function blit(target: any, clear = false) {
      if (target == null) {
        g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight)
        g.bindFramebuffer(g.FRAMEBUFFER, null)
      } else {
        g.viewport(0, 0, target.width, target.height)
        g.bindFramebuffer(g.FRAMEBUFFER, target.fbo)
      }
      if (clear) {
        g.clearColor(0.0, 0.0, 0.0, 1.0)
        g.clear(g.COLOR_BUFFER_BIT)
      }
      g.bindVertexArray(quadVAO)
      g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0)
      g.bindVertexArray(null)
    }

    // ── Shaders — matching gpu-io/examples/fluid exactly ──

    const baseVertexShader = compileShader(g.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const copyShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `)

    // Splat: Gaussian velocity injection with magnitude clamping (matches repo touch shader)
    const splatShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        vec2 v = base.xy + splat.xy;
        float mag = length(v);
        if (mag > ${MAX_VELOCITY.toFixed(1)}) v *= ${MAX_VELOCITY.toFixed(1)} / mag;
        gl_FragColor = vec4(v, 0.0, 1.0);
      }
    `)

    // Advection: exactly matches repo — no dt, no dissipation
    // uDimensions = canvas dimensions (repo line 148 & 634)
    const advectionShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 uDimensions;
      void main () {
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vec2 coord = vUv - vel / uDimensions;
        gl_FragColor = texture2D(uSource, coord);
      }
    `)

    // Curl: compute curl of velocity field (scalar in 2D)
    const curlShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 uPxSize;
      void main () {
        float T = texture2D(uVelocity, vUv + vec2(0.0, uPxSize.y)).x;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uPxSize.y)).x;
        float R = texture2D(uVelocity, vUv + vec2(uPxSize.x, 0.0)).y;
        float L = texture2D(uVelocity, vUv - vec2(uPxSize.x, 0.0)).y;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);
      }
    `)

    // Vorticity confinement: gently re-injects curl to sustain ambient flow
    const vorticityShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform vec2 uPxSize;
      uniform float uCurlStrength;
      void main () {
        float T = texture2D(uCurl, vUv + vec2(0.0, uPxSize.y)).x;
        float B = texture2D(uCurl, vUv - vec2(0.0, uPxSize.y)).x;
        float R = texture2D(uCurl, vUv + vec2(uPxSize.x, 0.0)).x;
        float L = texture2D(uCurl, vUv - vec2(uPxSize.x, 0.0)).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0002;
        force *= uCurlStrength * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy + force;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `)

    // Divergence: matches repo exactly
    const divergenceShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 uPxSize;
      void main () {
        float n = texture2D(uVelocity, vUv + vec2(0.0, uPxSize.y)).y;
        float s = texture2D(uVelocity, vUv - vec2(0.0, uPxSize.y)).y;
        float e = texture2D(uVelocity, vUv + vec2(uPxSize.x, 0.0)).x;
        float w = texture2D(uVelocity, vUv - vec2(uPxSize.x, 0.0)).x;
        float div = 0.5 * (e - w + n - s);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `)

    // Jacobi pressure solver: matches repo exactly (α=-1, β=0.25)
    const pressureShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      uniform vec2 uPxSize;
      void main () {
        vec4 n = texture2D(uPressure, vUv + vec2(0.0, uPxSize.y));
        vec4 s = texture2D(uPressure, vUv - vec2(0.0, uPxSize.y));
        vec4 e = texture2D(uPressure, vUv + vec2(uPxSize.x, 0.0));
        vec4 w = texture2D(uPressure, vUv - vec2(uPxSize.x, 0.0));
        vec4 d = texture2D(uDivergence, vUv);
        gl_FragColor = (n + s + e + w + ${PRESSURE_CALC_ALPHA.toFixed(1)} * d) * ${PRESSURE_CALC_BETA.toFixed(4)};
      }
    `)

    // Gradient subtraction + MAX_VELOCITY clamp (safety net for vorticity confinement)
    const gradientSubtractShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform vec2 uPxSize;
      void main () {
        float n = texture2D(uPressure, vUv + vec2(0.0, uPxSize.y)).x;
        float s = texture2D(uPressure, vUv - vec2(0.0, uPxSize.y)).x;
        float e = texture2D(uPressure, vUv + vec2(uPxSize.x, 0.0)).x;
        float w = texture2D(uPressure, vUv - vec2(uPxSize.x, 0.0)).x;
        vec2 vel = texture2D(uVelocity, vUv).xy - 0.5 * vec2(e - w, n - s);
        float mag = length(vel);
        if (mag > ${MAX_VELOCITY.toFixed(1)}) vel *= ${MAX_VELOCITY.toFixed(1)} / mag;
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `)

    // ── Vector Field Shaders (GLSL 300 es for gl_VertexID) ──
    // Matches repo's LayerVectorFieldVertexShader exactly
    const vectorFieldVS = compileShader(g.VERTEX_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D u_velocity;
      uniform vec2 u_dimensions;
      uniform vec2 u_scale;
      flat out float v_speed;
      void main() {
        int lineIndex = gl_VertexID / 2;
        int isEnd = gl_VertexID - 2 * lineIndex;
        int dimX = int(u_dimensions.x);
        int y = lineIndex / dimX;
        int x = lineIndex - y * dimX;
        vec2 uv = vec2(float(x) + 0.5, float(y) + 0.5) / u_dimensions;
        vec2 vel = texture(u_velocity, uv).xy;
        v_speed = length(vel);
        vec2 pos = uv + float(isEnd) * vel * u_scale;
        gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
      }
    `)

    const vectorFieldFS = compileShader(g.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      uniform vec3 u_color;
      flat in float v_speed;
      out vec4 fragColor;
      void main() {
        float alpha = clamp(v_speed * 0.1 + 0.22, 0.0, 0.7);
        fragColor = vec4(u_color * alpha, alpha);
      }
    `)

    // ── Programs ──
    const copyProgram = new Program(baseVertexShader, copyShader)
    const splatProgram = new Program(baseVertexShader, splatShader)
    const advectionProgram = new Program(baseVertexShader, advectionShader)
    const curlProgram = new Program(baseVertexShader, curlShader)
    const vorticityProgram = new Program(baseVertexShader, vorticityShader)
    const divergenceProgram = new Program(baseVertexShader, divergenceShader)
    const pressureProgram = new Program(baseVertexShader, pressureShader)
    const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)
    const vectorFieldProgram = new Program(vectorFieldVS, vectorFieldFS)

    // ── FBO helpers ──
    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.REPEAT) {
      g.activeTexture(g.TEXTURE0)
      const texture = g.createTexture()!
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, wrap)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, wrap)
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

      const fbo = g.createFramebuffer()!
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
      g.viewport(0, 0, w, h)
      g.clear(g.COLOR_BUFFER_BIT)

      return {
        texture, fbo, width: w, height: h,
        texelSizeX: 1.0 / w, texelSizeY: 1.0 / h,
        attach(id: number) {
          g.activeTexture(g.TEXTURE0 + id)
          g.bindTexture(g.TEXTURE_2D, texture)
          return id
        },
      }
    }

    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.REPEAT) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param, wrap)
      let fbo2 = createFBO(w, h, internalFormat, format, type, param, wrap)
      return {
        width: w, height: h,
        texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1 },
        set read(value) { fbo1 = value },
        get write() { return fbo2 },
        set write(value) { fbo2 = value },
        swap() { const temp = fbo1; fbo1 = fbo2; fbo2 = temp },
      }
    }

    function resizeFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.REPEAT) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param, wrap)
      copyProgram.bind()
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
      blit(newFBO)
      return newFBO
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.REPEAT) {
      if (target.width === w && target.height === h) return target
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param, wrap)
      target.write = createFBO(w, h, internalFormat, format, type, param, wrap)
      target.width = w; target.height = h
      target.texelSizeX = 1.0 / w; target.texelSizeY = 1.0 / h
      return target
    }

    // ── Fluid framebuffers — float32 matching repo (type: FLOAT) ──
    let velocity: any, divergenceFBO: any, pressure: any, curlFBO: any

    function initFluidFramebuffers() {
      const w = Math.ceil(canvas.width / VELOCITY_SCALE_FACTOR)
      const h = Math.ceil(canvas.height / VELOCITY_SCALE_FACTOR)
      g.disable(g.BLEND)

      if (!velocity)
        velocity = createDoubleFBO(w, h, g.RG32F, g.RG, g.FLOAT, g.LINEAR)
      else
        velocity = resizeDoubleFBO(velocity, w, h, g.RG32F, g.RG, g.FLOAT, g.LINEAR)

      curlFBO = createFBO(w, h, g.R32F, g.RED, g.FLOAT, g.NEAREST)
      divergenceFBO = createFBO(w, h, g.R32F, g.RED, g.FLOAT, g.NEAREST)
      pressure = createDoubleFBO(w, h, g.R32F, g.RED, g.FLOAT, g.NEAREST)
    }

    initFluidFramebuffers()

    // ── Splat functions ──
    function splat(x: number, y: number, dx: number, dy: number) {
      splatProgram.bind()
      g.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
      g.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
      g.uniform2f(splatProgram.uniforms.point, x, y)
      g.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
      g.uniform1f(splatProgram.uniforms.radius, SPLAT_RADIUS)
      blit(velocity.write)
      velocity.swap()
    }

    function multipleSplats(amount: number) {
      for (let i = 0; i < amount; i++) {
        const x = Math.random()
        const y = Math.random()
        const dx = MAX_VELOCITY * (Math.random() - 0.5) * 2
        const dy = MAX_VELOCITY * (Math.random() - 0.5) * 2
        splat(x, y, dx, dy)
      }
    }

    function splatPointer(pointer: Pointer) {
      const dx = pointer.deltaX * SPLAT_FORCE
      const dy = pointer.deltaY * SPLAT_FORCE
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy)
    }

    // Gentle ambient splats — random position, random low-velocity direction
    function autoSplat() {
      for (let i = 0; i < AUTO_SPLAT_COUNT; i++) {
        const x = Math.random()
        const y = Math.random()
        const angle = Math.random() * Math.PI * 2
        const dx = Math.cos(angle) * AUTO_SPLAT_STRENGTH
        const dy = Math.sin(angle) * AUTO_SPLAT_STRENGTH
        splat(x, y, dx, dy)
      }
    }

    // ── Navier-Stokes step ──
    // advect → curl → vorticity → divergence → jacobi × 3 → gradient subtract
    function step() {
      g.disable(g.BLEND)
      const pxSize = [velocity.texelSizeX, velocity.texelSizeY] as const

      // 1. Advect velocity — uDimensions = canvas dimensions (repo line 148 & 634)
      advectionProgram.bind()
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0))
      g.uniform2f(advectionProgram.uniforms.uDimensions, canvas.width, canvas.height)
      blit(velocity.write)
      velocity.swap()

      // 2. Compute curl of velocity
      curlProgram.bind()
      g.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform2f(curlProgram.uniforms.uPxSize, pxSize[0], pxSize[1])
      blit(curlFBO)

      // 3. Vorticity confinement — gently sustains ambient flow
      vorticityProgram.bind()
      g.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1))
      g.uniform2f(vorticityProgram.uniforms.uPxSize, pxSize[0], pxSize[1])
      g.uniform1f(vorticityProgram.uniforms.uCurlStrength, CURL)
      blit(velocity.write)
      velocity.swap()

      // 4. Compute divergence
      divergenceProgram.bind()
      g.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform2f(divergenceProgram.uniforms.uPxSize, pxSize[0], pxSize[1])
      blit(divergenceFBO)

      // 5. Jacobi pressure iterations
      pressureProgram.bind()
      g.uniform2f(pressureProgram.uniforms.uPxSize, pxSize[0], pxSize[1])
      g.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(1))
      for (let i = 0; i < NUM_JACOBI_STEPS; i++) {
        g.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(0))
        blit(pressure.write)
        pressure.swap()
      }

      // 6. Subtract pressure gradient from velocity
      gradientSubtractProgram.bind()
      g.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
      g.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
      g.uniform2f(gradientSubtractProgram.uniforms.uPxSize, pxSize[0], pxSize[1])
      blit(velocity.write)
      velocity.swap()
    }

    // ── Render vector field — matches repo's drawLayerAsVectorField ──
    function renderVectorField() {
      const gridW = Math.floor(g.drawingBufferWidth / VECTOR_SPACING)
      const gridH = Math.floor(g.drawingBufferHeight / VECTOR_SPACING)
      const numVectors = gridW * gridH
      if (numVectors <= 0) return

      g.bindFramebuffer(g.FRAMEBUFFER, null)
      g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight)
      g.clearColor(0.0, 0.0, 0.0, 1.0)
      g.clear(g.COLOR_BUFFER_BIT)

      g.enable(g.BLEND)
      g.blendFunc(g.SRC_ALPHA, g.ONE)

      vectorFieldProgram.bind()
      g.uniform1i(vectorFieldProgram.uniforms.u_velocity, velocity.read.attach(0))
      g.uniform2f(vectorFieldProgram.uniforms.u_dimensions, gridW, gridH)
      g.uniform2f(vectorFieldProgram.uniforms.u_scale,
        VECTOR_SCALE / g.drawingBufferWidth,
        VECTOR_SCALE / g.drawingBufferHeight)
      g.uniform3f(vectorFieldProgram.uniforms.u_color, 0.35, 0.12, 0.55)

      g.bindVertexArray(emptyVAO)
      g.drawArrays(g.LINES, 0, numVectors * 2)
      g.bindVertexArray(null)

      g.disable(g.BLEND)
    }

    // ── Input handling ──
    function correctDeltaX(delta: number) {
      const a = canvas.width / canvas.height
      if (a < 1) delta *= a
      return delta
    }

    function correctDeltaY(delta: number) {
      const a = canvas.width / canvas.height
      if (a > 1) delta /= a
      return delta
    }

    function resizeCanvas() {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        return true
      }
      return false
    }

    function getCanvasRelativePos(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        inBounds: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) return
      if ((e.target as HTMLElement).closest("[data-no-splat], aside, button, textarea, input, a")) return
      pointers[0].id = -1
      pointers[0].down = true
      pointers[0].moved = false
      pointers[0].texcoordX = x / canvas.width
      pointers[0].texcoordY = 1.0 - y / canvas.height
      pointers[0].prevTexcoordX = pointers[0].texcoordX
      pointers[0].prevTexcoordY = pointers[0].texcoordY
      pointers[0].deltaX = 0
      pointers[0].deltaY = 0
      splatStack.push(Math.floor(Math.random() * 3) + 2)
    }

    const onMouseMove = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) {
        if (pointers[0].down) pointers[0].down = false
        return
      }
      if (!pointers[0].down) {
        pointers[0].texcoordX = x / canvas.width
        pointers[0].texcoordY = 1.0 - y / canvas.height
        pointers[0].prevTexcoordX = pointers[0].texcoordX
        pointers[0].prevTexcoordY = pointers[0].texcoordY
        pointers[0].down = true
      }
      pointers[0].prevTexcoordX = pointers[0].texcoordX
      pointers[0].prevTexcoordY = pointers[0].texcoordY
      pointers[0].texcoordX = x / canvas.width
      pointers[0].texcoordY = 1.0 - y / canvas.height
      pointers[0].deltaX = correctDeltaX(pointers[0].texcoordX - pointers[0].prevTexcoordX)
      pointers[0].deltaY = correctDeltaY(pointers[0].texcoordY - pointers[0].prevTexcoordY)
      pointers[0].moved = Math.abs(pointers[0].deltaX) > 0 || Math.abs(pointers[0].deltaY) > 0
    }

    const onTouchStart = (e: TouchEvent) => {
      const touches = e.touches
      if (!touches.length) return
      while (touches.length >= pointers.length) pointers.push(new Pointer())
      for (let i = 0; i < touches.length; i++) {
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        const p = pointers[i + 1]
        p.id = touches[i].identifier
        p.down = true; p.moved = false
        p.texcoordX = x / canvas.width
        p.texcoordY = 1.0 - y / canvas.height
        p.prevTexcoordX = p.texcoordX
        p.prevTexcoordY = p.texcoordY
        p.deltaX = 0; p.deltaY = 0
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const touches = e.touches
      for (let i = 0; i < touches.length; i++) {
        const p = pointers[i + 1]
        if (!p?.down) continue
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        p.prevTexcoordX = p.texcoordX
        p.prevTexcoordY = p.texcoordY
        p.texcoordX = x / canvas.width
        p.texcoordY = 1.0 - y / canvas.height
        p.deltaX = correctDeltaX(p.texcoordX - p.prevTexcoordX)
        p.deltaY = correctDeltaY(p.texcoordY - p.prevTexcoordY)
        p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const pointer = pointers.find((p) => p.id === e.changedTouches[i].identifier)
        if (pointer) pointer.down = false
      }
    }

    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", onTouchEnd)

    // ── Main loop ──
    let animFrame = 0
    let frameCount = 0

    function update() {
      if (resizeCanvas()) {
        initFluidFramebuffers()
      }

      if (splatStack.length > 0) multipleSplats(splatStack.pop()!)
      pointers.forEach((p) => {
        if (p.moved) { p.moved = false; splatPointer(p) }
      })

      // Periodic ambient splats — keeps velocity field alive without user interaction
      frameCount++
      if (frameCount % AUTO_SPLAT_INTERVAL === 0) {
        autoSplat()
      }

      step()
      renderVectorField()

      animFrame = requestAnimationFrame(update)
    }

    // Seed initial flow — enough splats to fill the field with ambient velocity
    splatStack.push(20)
    update()

    return () => {
      cancelAnimationFrame(animFrame)
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "all",
      }}
    />
  )
}
