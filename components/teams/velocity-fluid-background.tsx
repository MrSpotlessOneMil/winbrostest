"use client"

/*
 * WebGL Velocity Field Visualization - React Component
 * Forked from fluid-background.tsx (Pavel Dobryakov's WebGL-Fluid-Simulation, MIT License)
 * https://github.com/PavelDoGreat/WebGL-Fluid-Simulation
 *
 * Renders the VELOCITY FIELD directly as purple brightness,
 * instead of advected dye. Stripped of bloom, sunrays, shading,
 * dye FBOs, and dithering for a lean side-panel effect.
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
    const canvas = canvasEl! // non-null alias for TS

    // -- Resize canvas FIRST (before any WebGL setup) --
    function scaleByPixelRatio(input: number) {
      const pixelRatio = window.devicePixelRatio || 1
      return Math.floor(input * pixelRatio)
    }

    canvas.width = scaleByPixelRatio(canvas.clientWidth)
    canvas.height = scaleByPixelRatio(canvas.clientHeight)

    // -- Config --
    const config = {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 512,
      VELOCITY_DISSIPATION: 1.5,
      PRESSURE: 0.13,
      PRESSURE_ITERATIONS: 20,
      CURL: 30,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 6000,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      TRANSPARENT: false,
    }

    // -- Pointer prototype --
    class Pointer {
      id = -1
      texcoordX = 0
      texcoordY = 0
      prevTexcoordX = 0
      prevTexcoordY = 0
      deltaX = 0
      deltaY = 0
      down = false
      moved = false
      color: { r: number; g: number; b: number } = { r: 30, g: 0, b: 30 }
    }

    const pointers: Pointer[] = [new Pointer()]
    const splatStack: number[] = []

    // -- WebGL Context --
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    let gl = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null
    const isWebGL2 = !!gl
    if (!isWebGL2) {
      gl = (canvas.getContext("webgl", params) || canvas.getContext("experimental-webgl", params)) as WebGL2RenderingContext | null
    }
    if (!gl) return

    const g = gl!

    let halfFloat: any
    let supportLinearFiltering: any
    if (isWebGL2) {
      g.getExtension("EXT_color_buffer_float")
      supportLinearFiltering = g.getExtension("OES_texture_float_linear")
    } else {
      halfFloat = g.getExtension("OES_texture_half_float")
      supportLinearFiltering = g.getExtension("OES_texture_half_float_linear")
    }

    g.clearColor(0.0, 0.0, 0.0, 1.0)

    const halfFloatTexType = isWebGL2 ? (g as WebGL2RenderingContext).HALF_FLOAT : halfFloat?.HALF_FLOAT_OES

    type TexFormat = { internalFormat: number; format: number } | null

    function getSupportedFormat(internalFormat: number, format: number, type: number): TexFormat {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
          case (g as any).R16F:
            return getSupportedFormat((g as any).RG16F, (g as any).RG, type)
          case (g as any).RG16F:
            return getSupportedFormat((g as any).RGBA16F, g.RGBA, type)
          default:
            return null
        }
      }
      return { internalFormat, format }
    }

    function supportRenderTextureFormat(internalFormat: number, format: number, type: number) {
      const texture = g.createTexture()
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)
      const fbo = g.createFramebuffer()
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
      const status = g.checkFramebufferStatus(g.FRAMEBUFFER)
      return status === g.FRAMEBUFFER_COMPLETE
    }

    let formatRGBA: TexFormat, formatRG: TexFormat, formatR: TexFormat
    if (isWebGL2) {
      const g2 = g as WebGL2RenderingContext
      formatRGBA = getSupportedFormat(g2.RGBA16F, g2.RGBA, halfFloatTexType)
      formatRG = getSupportedFormat(g2.RG16F, g2.RG, halfFloatTexType)
      formatR = getSupportedFormat(g2.R16F, g2.RED, halfFloatTexType)
    } else {
      formatRGBA = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
      formatRG = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
      formatR = getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType)
    }

    if (!supportLinearFiltering) {
      config.DYE_RESOLUTION = 512
    }

    // -- Shader compilation --
    function compileShader(type: number, source: string, keywords?: string[] | null) {
      source = addKeywords(source, keywords)
      const shader = g.createShader(type)!
      g.shaderSource(shader, source)
      g.compileShader(shader)
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS))
        console.trace(g.getShaderInfoLog(shader))
      return shader
    }

    function addKeywords(source: string, keywords?: string[] | null) {
      if (!keywords) return source
      let keywordsString = ""
      keywords.forEach((keyword) => {
        keywordsString += "#define " + keyword + "\n"
      })
      return keywordsString + source
    }

    // -- Program class --
    function createProgramFromShaders(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = g.createProgram()!
      g.attachShader(program, vertexShader)
      g.attachShader(program, fragmentShader)
      g.linkProgram(program)
      if (!g.getProgramParameter(program, g.LINK_STATUS))
        console.trace(g.getProgramInfoLog(program))
      return program
    }

    function getUniforms(program: WebGLProgram) {
      const uniforms: Record<string, WebGLUniformLocation | null> = {}
      const uniformCount = g.getProgramParameter(program, g.ACTIVE_UNIFORMS)
      for (let i = 0; i < uniformCount; i++) {
        const uniformName = g.getActiveUniform(program, i)!.name
        uniforms[uniformName] = g.getUniformLocation(program, uniformName)
      }
      return uniforms
    }

    class Program {
      uniforms: Record<string, WebGLUniformLocation | null>
      program: WebGLProgram

      constructor(vertexShader: WebGLShader, fragmentShader: WebGLShader) {
        this.program = createProgramFromShaders(vertexShader, fragmentShader)
        this.uniforms = getUniforms(this.program)
      }

      bind() {
        g.useProgram(this.program)
      }
    }

    // -- Shaders --
    const baseVertexShader = compileShader(g.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const copyShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `)

    const clearShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `)

    const colorShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 color;
      void main () { gl_FragColor = color; }
    `)

    const velocityDisplayShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform vec2 texelSize;

      void main () {
        vec2 vel = texture2D(uVelocity, vUv).xy;
        float speed = length(vel);

        // Normalize speed for visualization (adjust sensitivity)
        float intensity = clamp(speed * 0.15, 0.0, 1.0);
        intensity = pow(intensity, 0.7); // gamma for better low-speed visibility

        // Osiris purple base: #a855f7 = (0.659, 0.333, 0.969)
        vec3 purple = vec3(0.659, 0.333, 0.969);

        // Subtle hue shift based on velocity direction
        float angle = atan(vel.y, vel.x);
        float hueShift = sin(angle) * 0.08;
        purple.r += hueShift;
        purple.b -= hueShift * 0.5;

        // Ambient glow + velocity-driven brightness
        vec3 color = purple * (0.02 + intensity * 0.98);

        float alpha = max(color.r, max(color.g, color.b));
        gl_FragColor = vec4(color, alpha);
      }
    `)

    const splatShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
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
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `)

    const advectionShader = compileShader(
      g.FRAGMENT_SHADER,
      `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform vec2 dyeTexelSize;
      uniform float dt;
      uniform float dissipation;
      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
        vec2 st = uv / tsize - 0.5;
        vec2 iuv = floor(st);
        vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
        vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
        vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
        vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
      }
      void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
      }
    `,
      supportLinearFiltering ? null : ["MANUAL_FILTERING"]
    )

    const divergenceShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; }
        if (vR.x > 1.0) { R = -C.x; }
        if (vT.y > 1.0) { T = -C.y; }
        if (vB.y < 0.0) { B = -C.y; }
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `)

    const curlShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `)

    const vorticityShader = compileShader(g.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    const pressureShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `)

    const gradientSubtractShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    // -- Blit setup (fullscreen quad) --
    const blit = (() => {
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer())
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW)
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, g.createBuffer())
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW)
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0)
      g.enableVertexAttribArray(0)

      return (target: any, clear = false) => {
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
        g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0)
      }
    })()

    // -- Create programs --
    const copyProgram = new Program(baseVertexShader, copyShader)
    const clearProgram = new Program(baseVertexShader, clearShader)
    const colorProgram = new Program(baseVertexShader, colorShader)
    const splatProgram = new Program(baseVertexShader, splatShader)
    const advectionProgram = new Program(baseVertexShader, advectionShader)
    const divergenceProgram = new Program(baseVertexShader, divergenceShader)
    const curlProgram = new Program(baseVertexShader, curlShader)
    const vorticityProgram = new Program(baseVertexShader, vorticityShader)
    const pressureProgram = new Program(baseVertexShader, pressureShader)
    const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)
    const velocityDisplayProgram = new Program(baseVertexShader, velocityDisplayShader)

    // -- FBO helpers --
    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      g.activeTexture(g.TEXTURE0)
      const texture = g.createTexture()!
      g.bindTexture(g.TEXTURE_2D, texture)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

      const fbo = g.createFramebuffer()!
      g.bindFramebuffer(g.FRAMEBUFFER, fbo)
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0)
      g.viewport(0, 0, w, h)
      g.clear(g.COLOR_BUFFER_BIT)

      const texelSizeX = 1.0 / w
      const texelSizeY = 1.0 / h

      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX,
        texelSizeY,
        attach(id: number) {
          g.activeTexture(g.TEXTURE0 + id)
          g.bindTexture(g.TEXTURE_2D, texture)
          return id
        },
      }
    }

    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param)
      let fbo2 = createFBO(w, h, internalFormat, format, type, param)
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() { return fbo1 },
        set read(value) { fbo1 = value },
        get write() { return fbo2 },
        set write(value) { fbo2 = value },
        swap() { const temp = fbo1; fbo1 = fbo2; fbo2 = temp },
      }
    }

    function resizeFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param)
      copyProgram.bind()
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
      blit(newFBO)
      return newFBO
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number) {
      if (target.width === w && target.height === h) return target
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param)
      target.write = createFBO(w, h, internalFormat, format, type, param)
      target.width = w
      target.height = h
      target.texelSizeX = 1.0 / w
      target.texelSizeY = 1.0 / h
      return target
    }

    // -- Framebuffer initialization (velocity, divergence, curl, pressure only) --
    let velocity: any, divergenceFBO: any, curlFBO: any, pressure: any

    function initFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION)
      const texType = halfFloatTexType
      const rg = formatRG!
      const r = formatR!
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST

      g.disable(g.BLEND)

      if (!velocity)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
      else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)

      divergenceFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      curlFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
    }

    initFramebuffers()

    // -- Color generation (Osiris purple/black theme) --
    function generateColor() {
      const c = HSVtoRGB(270 / 360, 1.0, 1.0)
      c.r *= 0.024
      c.g *= 0.024
      c.b *= 0.024
      return c
    }

    function HSVtoRGB(h: number, s: number, v: number) {
      let r = 0, g2 = 0, b = 0
      const i = Math.floor(h * 6)
      const f = h * 6 - i
      const p = v * (1 - s)
      const q = v * (1 - f * s)
      const t = v * (1 - (1 - f) * s)
      switch (i % 6) {
        case 0: r = v; g2 = t; b = p; break
        case 1: r = q; g2 = v; b = p; break
        case 2: r = p; g2 = v; b = t; break
        case 3: r = p; g2 = q; b = v; break
        case 4: r = t; g2 = p; b = v; break
        case 5: r = v; g2 = p; b = q; break
      }
      return { r, g: g2, b }
    }

    function normalizeColor(input: { r: number; g: number; b: number }) {
      return { r: input.r / 255, g: input.g / 255, b: input.b / 255 }
    }

    // -- Splat functions (velocity only, no dye) --
    function splat(x: number, y: number, dx: number, dy: number, _color: { r: number; g: number; b: number }) {
      splatProgram.bind()
      g.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0))
      g.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height)
      g.uniform2f(splatProgram.uniforms.point, x, y)
      g.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
      g.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0))
      blit(velocity.write)
      velocity.swap()
    }

    function multipleSplats(amount: number) {
      for (let i = 0; i < amount; i++) {
        const color = generateColor()
        color.r *= 10.0
        color.g *= 10.0
        color.b *= 10.0
        const x = Math.random()
        const y = Math.random()
        const dx = 1000 * (Math.random() - 0.5)
        const dy = 1000 * (Math.random() - 0.5)
        splat(x, y, dx, dy, color)
      }
    }

    function splatPointer(pointer: Pointer) {
      const dx = pointer.deltaX * config.SPLAT_FORCE
      const dy = pointer.deltaY * config.SPLAT_FORCE
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy, pointer.color)
    }

    function correctRadius(radius: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio > 1) radius *= aspectRatio
      return radius
    }

    // -- Simulation step (velocity advection only, no dye advection) --
    function step(dt: number) {
      g.disable(g.BLEND)

      curlProgram.bind()
      g.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(curlFBO)

      vorticityProgram.bind()
      g.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0))
      g.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1))
      g.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
      g.uniform1f(vorticityProgram.uniforms.dt, dt)
      blit(velocity.write)
      velocity.swap()

      divergenceProgram.bind()
      g.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(divergenceFBO)

      clearProgram.bind()
      g.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0))
      g.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
      blit(pressure.write)
      pressure.swap()

      pressureProgram.bind()
      g.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(pressureProgram.uniforms.uDivergence, divergenceFBO.attach(0))
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        g.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1))
        blit(pressure.write)
        pressure.swap()
      }

      gradientSubtractProgram.bind()
      g.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      g.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0))
      g.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1))
      blit(velocity.write)
      velocity.swap()

      advectionProgram.bind()
      g.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY)
      if (!supportLinearFiltering)
        g.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY)
      const velocityId = velocity.read.attach(0)
      g.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
      g.uniform1i(advectionProgram.uniforms.uSource, velocityId)
      g.uniform1f(advectionProgram.uniforms.dt, dt)
      g.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
      blit(velocity.write)
      velocity.swap()
    }

    // -- Render (velocity display, no bloom/sunrays) --
    function render(target: any) {
      g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA)
      g.enable(g.BLEND)

      if (!config.TRANSPARENT) drawColor(target, normalizeColor(config.BACK_COLOR))
      drawDisplay(target)
    }

    function drawColor(target: any, color: { r: number; g: number; b: number }) {
      colorProgram.bind()
      g.uniform4f(colorProgram.uniforms.color, color.r, color.g, color.b, 1)
      blit(target)
    }

    function drawDisplay(target: any) {
      const width = target == null ? g.drawingBufferWidth : target.width
      const height = target == null ? g.drawingBufferHeight : target.height

      velocityDisplayProgram.bind()
      g.uniform2f(velocityDisplayProgram.uniforms.texelSize, 1.0 / width, 1.0 / height)
      g.uniform1i(velocityDisplayProgram.uniforms.uVelocity, velocity.read.attach(0))
      blit(target)
    }

    // -- Utility functions --
    function getResolution(resolution: number) {
      let aspectRatio = g.drawingBufferWidth / g.drawingBufferHeight
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
      const min = Math.round(resolution)
      const max = Math.round(resolution * aspectRatio)
      if (g.drawingBufferWidth > g.drawingBufferHeight) return { width: max, height: min }
      else return { width: min, height: max }
    }

    function correctDeltaX(delta: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio < 1) delta *= aspectRatio
      return delta
    }

    function correctDeltaY(delta: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio > 1) delta /= aspectRatio
      return delta
    }

    function resizeCanvas() {
      const width = scaleByPixelRatio(canvas.clientWidth)
      const height = scaleByPixelRatio(canvas.clientHeight)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        return true
      }
      return false
    }

    // -- Input handling --
    function updatePointerDownData(pointer: Pointer, id: number, posX: number, posY: number) {
      pointer.id = id
      pointer.down = true
      pointer.moved = false
      pointer.texcoordX = posX / canvas.width
      pointer.texcoordY = 1.0 - posY / canvas.height
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.deltaX = 0
      pointer.deltaY = 0
      pointer.color = generateColor()
    }

    function updatePointerMoveData(pointer: Pointer, posX: number, posY: number) {
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.texcoordX = posX / canvas.width
      pointer.texcoordY = 1.0 - posY / canvas.height
      pointer.deltaX = correctDeltaX(pointer.texcoordX - pointer.prevTexcoordX)
      pointer.deltaY = correctDeltaY(pointer.texcoordY - pointer.prevTexcoordY)
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
    }

    function updatePointerUpData(pointer: Pointer) {
      pointer.down = false
    }

    function getCanvasRelativePos(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        inBounds: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom,
      }
    }

    // Mouse: window-level events so they work through z-index overlays
    const onMouseDown = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) return

      const target = e.target as HTMLElement
      if (target.closest("[data-no-splat], aside, button, textarea, input, a")) return

      const posX = scaleByPixelRatio(x)
      const posY = scaleByPixelRatio(y)
      updatePointerDownData(pointers[0], -1, posX, posY)
      splatStack.push(Math.floor(Math.random() * 3) + 2)
    }

    const onMouseMove = (e: MouseEvent) => {
      const { x, y, inBounds } = getCanvasRelativePos(e.clientX, e.clientY)
      if (!inBounds) {
        if (pointers[0].down) updatePointerUpData(pointers[0])
        return
      }
      const posX = scaleByPixelRatio(x)
      const posY = scaleByPixelRatio(y)
      if (!pointers[0].down) {
        pointers[0].texcoordX = posX / canvas.width
        pointers[0].texcoordY = 1.0 - posY / canvas.height
        pointers[0].prevTexcoordX = pointers[0].texcoordX
        pointers[0].prevTexcoordY = pointers[0].texcoordY
        pointers[0].down = true
      }
      updatePointerMoveData(pointers[0], posX, posY)
    }

    const onMouseUp = () => {
      // Don't set down=false so hovering continues to create splats
    }

    // Touch: window-level events
    const onTouchStart = (e: TouchEvent) => {
      const touches = e.touches
      if (!touches.length) return
      while (touches.length >= pointers.length) pointers.push(new Pointer())
      for (let i = 0; i < touches.length; i++) {
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        const posX = scaleByPixelRatio(x)
        const posY = scaleByPixelRatio(y)
        updatePointerDownData(pointers[i + 1], touches[i].identifier, posX, posY)
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      const touches = e.touches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointers[i + 1]
        if (!pointer?.down) continue
        const { x, y } = getCanvasRelativePos(touches[i].clientX, touches[i].clientY)
        const posX = scaleByPixelRatio(x)
        const posY = scaleByPixelRatio(y)
        updatePointerMoveData(pointer, posX, posY)
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touches = e.changedTouches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointers.find((p) => p.id === touches[i].identifier)
        if (pointer) updatePointerUpData(pointer)
      }
    }

    window.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", onTouchEnd)

    // -- Main loop --
    let lastUpdateTime = Date.now()
    let animFrame = 0

    function update() {
      const now = Date.now()
      let dt = (now - lastUpdateTime) / 1000
      dt = Math.min(dt, 0.016666)
      lastUpdateTime = now

      if (resizeCanvas()) initFramebuffers()

      // Apply pointer inputs
      if (splatStack.length > 0) multipleSplats(splatStack.pop()!)
      pointers.forEach((p) => {
        if (p.moved) {
          p.moved = false
          splatPointer(p)
        }
      })

      step(dt)
      render(null)
      animFrame = requestAnimationFrame(update)
    }

    update()

    // -- Cleanup --
    return () => {
      cancelAnimationFrame(animFrame)
      window.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
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
