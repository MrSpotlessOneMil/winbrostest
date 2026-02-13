"use client"

/*
 * WebGL2 Velocity Vector Field Visualization
 * Navier-Stokes fluid sim + vector field rendering (GL_LINES).
 * Matches gpu-io "Velocity" display mode: short line segments show
 * velocity direction/magnitude at a grid of sample points.
 * Purple on black, Osiris brand.
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

    const config = {
      SIM_RESOLUTION: 128,
      VELOCITY_DISSIPATION: 0.01,
      PRESSURE: 0.13,
      PRESSURE_ITERATIONS: 20,
      CURL: 30,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 6000,
      VECTOR_SPACING: 10,
      VECTOR_SCALE: 0.5,
      MAX_VELOCITY: 60,
    }

    class Pointer {
      id = -1; texcoordX = 0; texcoordY = 0
      prevTexcoordX = 0; prevTexcoordY = 0
      deltaX = 0; deltaY = 0
      down = false; moved = false
    }

    const pointers: Pointer[] = [new Pointer()]
    const splatStack: number[] = []

    // ── WebGL2 Context (required for gl_VertexID) ──
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    const gl = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null
    if (!gl) return
    const g = gl

    g.getExtension("EXT_color_buffer_float")
    const supportLinearFiltering = g.getExtension("OES_texture_float_linear")
    g.getExtension("OES_texture_float")

    g.clearColor(0.0, 0.0, 0.0, 1.0)

    const halfFloatTexType = g.HALF_FLOAT

    type TexFormat = { internalFormat: number; format: number } | null

    function getSupportedFormat(internalFormat: number, format: number, type: number): TexFormat {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
          case g.R16F: return getSupportedFormat(g.RG16F, g.RG, type)
          case g.RG16F: return getSupportedFormat(g.RGBA16F, g.RGBA, type)
          default: return null
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
      g.deleteTexture(texture)
      g.deleteFramebuffer(fbo)
      g.bindFramebuffer(g.FRAMEBUFFER, null)
      return status === g.FRAMEBUFFER_COMPLETE
    }

    const formatRG = getSupportedFormat(g.RG16F, g.RG, halfFloatTexType)
    const formatR = getSupportedFormat(g.R16F, g.RED, halfFloatTexType)

    // ── Shader helpers ──
    function compileShader(type: number, source: string, keywords?: string[] | null) {
      if (keywords) {
        let defs = ""
        keywords.forEach((k) => { defs += "#define " + k + "\n" })
        source = defs + source
      }
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

    // ── VAOs for clean state management ──
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

    // Empty VAO for vector field (uses gl_VertexID, no attribs)
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

    // ── Navier-Stokes Shaders (GLSL 100 for blit programs) ──
    const baseVertexShader = compileShader(g.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL, vR, vT, vB;
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

    const advectionShader = compileShader(g.FRAGMENT_SHADER, `
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
        vec2 v = result.xy / decay;
        float mag = length(v);
        if (mag > 60.0) v *= 60.0 / mag;
        gl_FragColor = vec4(v, 0.0, 1.0);
      }
    `, supportLinearFiltering ? null : ["MANUAL_FILTERING"])

    const divergenceShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `)

    const curlShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv, vL, vR, vT, vB;
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
      varying vec2 vUv, vL, vR, vT, vB;
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
        float mag = length(velocity);
        if (mag > 60.0) velocity *= 60.0 / mag;
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    const pressureShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `)

    const gradientSubtractShader = compileShader(g.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv, vL, vR, vT, vB;
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

    // ── Vector Field Shaders (GLSL 300 es for gl_VertexID) ──
    const vectorFieldVS = compileShader(g.VERTEX_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D u_velocity;
      uniform vec2 u_dimensions;    // grid dimensions (num vectors X, Y)
      uniform vec2 u_scale;         // velocity scale in UV space
      flat out float v_speed;
      void main() {
        int lineIndex = gl_VertexID / 2;
        int isEnd = gl_VertexID - 2 * lineIndex; // 0 = base, 1 = tip
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
        float alpha = clamp(v_speed * 0.025 + 0.2, 0.0, 0.7);
        fragColor = vec4(u_color * alpha, alpha);
      }
    `)

    // ── Programs ──
    const copyProgram = new Program(baseVertexShader, copyShader)
    const clearProgram = new Program(baseVertexShader, clearShader)
    const splatProgram = new Program(baseVertexShader, splatShader)
    const advectionProgram = new Program(baseVertexShader, advectionShader)
    const divergenceProgram = new Program(baseVertexShader, divergenceShader)
    const curlProgram = new Program(baseVertexShader, curlShader)
    const vorticityProgram = new Program(baseVertexShader, vorticityShader)
    const pressureProgram = new Program(baseVertexShader, pressureShader)
    const gradientSubtractProgram = new Program(baseVertexShader, gradientSubtractShader)

    // Vector field program
    const vectorFieldProgram = new Program(vectorFieldVS, vectorFieldFS)

    // ── FBO helpers ──
    function createFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.CLAMP_TO_EDGE) {
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

    function createDoubleFBO(w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.CLAMP_TO_EDGE) {
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

    function resizeFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.CLAMP_TO_EDGE) {
      const newFBO = createFBO(w, h, internalFormat, format, type, param, wrap)
      copyProgram.bind()
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0))
      blit(newFBO)
      return newFBO
    }

    function resizeDoubleFBO(target: any, w: number, h: number, internalFormat: number, format: number, type: number, param: number, wrap = g.CLAMP_TO_EDGE) {
      if (target.width === w && target.height === h) return target
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param, wrap)
      target.write = createFBO(w, h, internalFormat, format, type, param, wrap)
      target.width = w; target.height = h
      target.texelSizeX = 1.0 / w; target.texelSizeY = 1.0 / h
      return target
    }

    // ── Fluid framebuffers ──
    let velocity: any, divergenceFBO: any, curlFBO: any, pressure: any

    function getResolution(resolution: number) {
      let aspectRatio = g.drawingBufferWidth / g.drawingBufferHeight
      if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio
      const min = Math.round(resolution)
      const max = Math.round(resolution * aspectRatio)
      if (g.drawingBufferWidth > g.drawingBufferHeight) return { width: max, height: min }
      else return { width: min, height: max }
    }

    function initFluidFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION)
      const texType = halfFloatTexType
      const rg = formatRG!
      const r = formatR!
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST
      g.disable(g.BLEND)

      if (!velocity)
        velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering, g.REPEAT)
      else
        velocity = resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering, g.REPEAT)

      divergenceFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      curlFBO = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
      pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, g.NEAREST)
    }

    initFluidFramebuffers()

    // ── Splat functions ──
    function splat(x: number, y: number, dx: number, dy: number) {
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
        const x = Math.random()
        const y = Math.random()
        const dx = 1000 * (Math.random() - 0.5)
        const dy = 1000 * (Math.random() - 0.5)
        splat(x, y, dx, dy)
      }
    }

    function splatPointer(pointer: Pointer) {
      const dx = pointer.deltaX * config.SPLAT_FORCE
      const dy = pointer.deltaY * config.SPLAT_FORCE
      splat(pointer.texcoordX, pointer.texcoordY, dx, dy)
    }

    function correctRadius(radius: number) {
      const aspectRatio = canvas.width / canvas.height
      if (aspectRatio > 1) radius *= aspectRatio
      return radius
    }

    // ── Navier-Stokes step ──
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

    // ── Render vector field ──
    function renderVectorField() {
      const spacing = config.VECTOR_SPACING
      const gridW = Math.floor(g.drawingBufferWidth / spacing)
      const gridH = Math.floor(g.drawingBufferHeight / spacing)
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
      g.uniform2f(vectorFieldProgram.uniforms.u_scale, config.VECTOR_SCALE / g.drawingBufferWidth, config.VECTOR_SCALE / g.drawingBufferHeight)
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
    let lastUpdateTime = Date.now()
    let animFrame = 0

    function update() {
      const now = Date.now()
      let dt = (now - lastUpdateTime) / 1000
      dt = Math.min(dt, 0.016666)
      lastUpdateTime = now

      if (resizeCanvas()) {
        initFluidFramebuffers()
      }

      if (splatStack.length > 0) multipleSplats(splatStack.pop()!)
      pointers.forEach((p) => {
        if (p.moved) { p.moved = false; splatPointer(p) }
      })

      step(dt)
      renderVectorField()

      animFrame = requestAnimationFrame(update)
    }

    // Initial splats seed the field — with near-zero dissipation + vorticity
    // confinement, the flow is self-sustaining (no ambient forcing needed)
    splatStack.push(8)
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
